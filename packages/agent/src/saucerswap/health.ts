import { type Address, formatUnits } from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { readClient } from "../chain";
import { type ReadOnlyConfig } from "../config";
import { type TokenRef } from "../networks";
import { amountForUsd, formatUsdPrice, quoteSwap } from "../oracles/math";
import { type MarketSnapshot, type OracleSnapshot } from "../oracles/snapshot";
import { vaultReadError } from "../vault/read";
import { getPoolState, missingPoolDetail, type PoolQuote, type PoolState, quotePool } from "./pool";
import { poolPriceUsd } from "./price";

/** Slippage tolerance assumed when no vault is configured. */
export const DEFAULT_MAX_SLIPPAGE_BPS = 300;

const ONE_USD_E18 = 10n ** 18n;

/** A $1 trade sized at the oracle price, as SaucerSwap would fill it and as the vault would judge it. */
export type TradeProbe = {
  /** In the input token's smallest unit. */
  amountIn: bigint;
  /** What SaucerSwap pays for `amountIn`, fee included. */
  amountOut: bigint;
  quoteSource: PoolQuote["source"];
  /** The vault's oracle-derived minimum output for `amountIn`. */
  minAmountOut: bigint;
  accepted: boolean;
};

export type PoolInspection = {
  state: PoolState;
  poolPriceUsd: number;
  /** (pool - oracle) / oracle in basis points; positive when the pool prices the base token above the oracle. */
  deviationBps: number;
  maxSlippageBps: number;
  /** $1 of the quote token in, base token out. */
  buy: TradeProbe;
  /** $1 of the base token in, quote token out. */
  sell: TradeProbe;
};

type PoolHealth = {
  pool: Address | null;
  poolPriceUsd: number | null;
  oraclePriceUsd: number;
  /** (pool - oracle) / oracle in basis points; positive when the pool prices the base token above the oracle. */
  deviationBps: number | null;
  /** Whether a $1 buy of the base token would clear the vault's oracle-derived minimum output. */
  buyAccepted: boolean | null;
  /** Whether a $1 sell of the base token would clear the vault's oracle-derived minimum output. */
  sellAccepted: boolean | null;
  detail: string;
};

/** The chain reads behind a pool inspection. The default reads Hedera over JSON-RPC; tests substitute fakes. */
export type PoolReads = {
  poolState(args: { tokenA: Address; tokenB: Address; fee: number }): Promise<PoolState | null>;
  quote(args: { tokenIn: Address; tokenOut: Address; fee: number; amountIn: bigint }): Promise<PoolQuote>;
  maxSlippageBps(): Promise<number>;
};

type Leg = { token: TokenRef; oracle: OracleSnapshot };

/**
 * Would the vault trade through SaucerSwap right now? The vault derives the swap's minimum output from the oracles,
 * so when the pool is priced away from them one direction reverts, however sound the agent's reasoning. This sizes a
 * $1 buy and a $1 sell at the oracle price, asks SaucerSwap what each returns and compares the result with the
 * minimum the vault would demand. Null when the configured pool does not exist.
 */
export async function inspectPool(
  cfg: ReadOnlyConfig,
  snapshot: MarketSnapshot,
  reads: PoolReads = chainReads(cfg),
): Promise<PoolInspection | null> {
  const base: Leg = { token: cfg.baseToken, oracle: snapshot.base };
  const quote: Leg = { token: cfg.quoteToken, oracle: snapshot.quote };
  const [state, maxSlippageBps] = await Promise.all([
    reads.poolState({ tokenA: base.token.address, tokenB: quote.token.address, fee: cfg.poolFee }),
    reads.maxSlippageBps(),
  ]);
  if (!state) return null;

  const priceUsd = poolPriceUsd(state, base.token, quote.token, snapshot.quote.priceUsd);
  const oracleUsd = snapshot.base.priceUsd;
  const [buy, sell] = await Promise.all([
    probeOneDollar(reads, cfg.poolFee, quote, base, maxSlippageBps),
    probeOneDollar(reads, cfg.poolFee, base, quote, maxSlippageBps),
  ]);
  return {
    state,
    poolPriceUsd: priceUsd,
    deviationBps: Math.round(((priceUsd - oracleUsd) / oracleUsd) * 10_000),
    maxSlippageBps,
    buy,
    sell,
  };
}

/** inspectPool condensed to JSON-safe fields and one explanatory sentence per finding. */
export async function poolHealth(
  cfg: ReadOnlyConfig,
  snapshot: MarketSnapshot,
  reads: PoolReads = chainReads(cfg),
): Promise<PoolHealth> {
  const oraclePriceUsd = snapshot.base.priceUsd;
  const inspection = await inspectPool(cfg, snapshot, reads);
  if (!inspection) {
    return {
      pool: null,
      poolPriceUsd: null,
      oraclePriceUsd,
      deviationBps: null,
      buyAccepted: null,
      sellAccepted: null,
      detail: missingPoolDetail(cfg),
    };
  }
  const { baseToken: base, quoteToken: quote } = cfg;
  return {
    pool: inspection.state.pool,
    poolPriceUsd: inspection.poolPriceUsd,
    oraclePriceUsd,
    deviationBps: inspection.deviationBps,
    buyAccepted: inspection.buy.accepted,
    sellAccepted: inspection.sell.accepted,
    detail: [
      `Pool prices ${base.symbol} at ${formatUsdPrice(inspection.poolPriceUsd)} ` +
        `vs oracle ${formatUsdPrice(oraclePriceUsd)} (${formatBps(inspection.deviationBps)}).`,
      describeProbe("buy", inspection.buy, base, inspection.maxSlippageBps),
      describeProbe("sell", inspection.sell, quote, inspection.maxSlippageBps),
    ].join(" "),
  };
}

export function formatBps(bps: number): string {
  return `${bps > 0 ? "+" : ""}${bps} bps`;
}

async function probeOneDollar(
  reads: PoolReads,
  fee: number,
  from: Leg,
  to: Leg,
  maxSlippageBps: number,
): Promise<TradeProbe> {
  const priceInE18 = BigInt(from.oracle.priceE18);
  const amountIn = amountForUsd(ONE_USD_E18, priceInE18, from.token.decimals);
  const quote = await reads.quote({ tokenIn: from.token.address, tokenOut: to.token.address, fee, amountIn });
  const { minAmountOut } = quoteSwap({
    amountIn,
    decimalsIn: from.token.decimals,
    priceInE18,
    decimalsOut: to.token.decimals,
    priceOutE18: BigInt(to.oracle.priceE18),
    maxSlippageBps,
  });
  // A zero minimum makes the vault revert with ZeroAmount whatever the pool would pay.
  const accepted = minAmountOut > 0n && quote.amountOut >= minAmountOut;
  return { amountIn, amountOut: quote.amountOut, quoteSource: quote.source, minAmountOut, accepted };
}

function chainReads(cfg: ReadOnlyConfig): PoolReads {
  return {
    poolState: args => getPoolState(cfg, args),
    quote: args => quotePool(cfg, args),
    maxSlippageBps: () => vaultMaxSlippageBps(cfg),
  };
}

async function vaultMaxSlippageBps(cfg: ReadOnlyConfig): Promise<number> {
  const vault = cfg.vaultAddress;
  if (!vault) return DEFAULT_MAX_SLIPPAGE_BPS;
  try {
    const policy = await readClient(cfg).readContract({ address: vault, abi: agentVaultAbi, functionName: "policy" });
    return policy.maxSlippageBps;
  } catch (error) {
    throw vaultReadError(error, vault, cfg.network);
  }
}

function describeProbe(side: "buy" | "sell", probe: TradeProbe, out: TokenRef, maxSlippageBps: number): string {
  const amount = (raw: bigint) => `${formatUnits(raw, out.decimals)} ${out.symbol}`;
  const paid =
    probe.quoteSource === "spot"
      ? `about ${amount(probe.amountOut)} out at the spot price`
      : `${amount(probe.amountOut)} out`;
  return (
    `$1 ${side}: ${paid} vs vault minimum ${amount(probe.minAmountOut)} ` +
    `(oracle - ${maxSlippageBps} bps): would ${probe.accepted ? "accept" : "refuse"}.`
  );
}
