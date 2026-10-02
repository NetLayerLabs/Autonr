import { describe, expect, it, vi } from "vitest";
import { type ReadOnlyConfig } from "../../src/config";
import { NETWORKS, type TokenRef } from "../../src/networks";
import { type MarketSnapshot, type OracleSnapshot } from "../../src/oracles/snapshot";
import { poolHealth, type PoolReads } from "../../src/saucerswap/health";
import { type PoolQuote, type PoolState } from "../../src/saucerswap/pool";
import { spotAmountOut } from "../../src/saucerswap/price";

const { baseToken: whbar, quoteToken: usdc } = NETWORKS.testnet;

// The endpoints are unreachable on purpose: every chain read goes through the fakes below.
const cfg: ReadOnlyConfig = {
  network: "testnet",
  rpcUrl: "http://127.0.0.1:1",
  mirrorUrl: "http://127.0.0.1:1",
  vaultAddress: null,
  topicId: null,
  agentAccountId: null,
  agentAddress: null,
  baseToken: whbar,
  quoteToken: usdc,
  poolFee: 3000,
  tickApiEnabled: false,
};

function oracle(token: TokenRef, priceE18: bigint): OracleSnapshot {
  return {
    token: token.address,
    symbol: token.symbol,
    feed: token.chainlinkLabel ?? token.supraLabel,
    source: token.chainlinkFeed ? "chainlink" : "supra",
    priceUsd: Number(priceE18) / 1e18,
    priceE18: priceE18.toString(),
    updatedAt: 1_790_000_000,
    ageSeconds: 30,
    crossCheck: null,
  };
}

/** Chainlink HBAR / USD at $0.10245 and Supra USDC_USD at $0.99997, as in the shared oracle vectors. */
const snapshot: MarketSnapshot = {
  fetchedAt: 1_790_000_030,
  base: oracle(whbar, 102_450_000_000_000_000n),
  quote: oracle(usdc, 999_970_000_000_000_000n),
};

/** A WHBAR/USDC pool (token0 USDC, token1 WHBAR) at the given sqrtPriceX96. */
function pool(sqrtPriceX96: bigint): PoolState {
  return {
    pool: "0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a",
    token0: usdc.address,
    token1: whbar.address,
    fee: 3000,
    sqrtPriceX96,
    tick: 0,
    liquidity: 125_349_437_318n,
  };
}

/** sqrtPriceX96 of that pool when one WHBAR costs `usdcPerWhbar`: 1e8 raw WHBAR per `usdcPerWhbar` * 1e6 raw USDC. */
function sqrtPriceX96For(usdcPerWhbar: number): bigint {
  return BigInt(Math.round(2 ** 96 * Math.sqrt(100 / usdcPerWhbar)));
}

/** The live testnet pool: SaucerSwap prices HBAR near $2.01 while the oracles say $0.10. */
const testnetPool = pool(558137174853493522622439261990n);
/** A pool priced exactly where the oracles are. */
const trackingPool = pool(sqrtPriceX96For(0.10245 / 0.99997));

/** Quotes at the pool's spot price minus the LP fee, without price impact: what a deep pool returns for $1. */
function fakeReads(state: PoolState | null, maxSlippageBps = 300, source: PoolQuote["source"] = "quoter") {
  return {
    poolState: vi.fn(async () => state),
    maxSlippageBps: vi.fn(async () => maxSlippageBps),
    quote: vi.fn(async ({ tokenIn, amountIn }: Parameters<PoolReads["quote"]>[0]): Promise<PoolQuote> => {
      if (!state) throw new Error("no pool to quote");
      return { amountOut: spotAmountOut(state, tokenIn, amountIn), source };
    }),
  } satisfies PoolReads;
}

describe("poolHealth", () => {
  it("accepts sells and refuses buys when the pool prices HBAR far above the oracle (testnet today)", async () => {
    const health = await poolHealth(cfg, snapshot, fakeReads(testnetPool));

    expect(health.pool).toBe(testnetPool.pool);
    expect(health.poolPriceUsd).toBeCloseTo(2.01495, 5);
    expect(health.oraclePriceUsd).toBe(0.10245);
    expect(health.deviationBps).toBe(186_676);
    expect(health.buyAccepted).toBe(false);
    expect(health.sellAccepted).toBe(true);
    expect(health.detail).toBe(
      "Pool prices WHBAR at $2.0149 vs oracle $0.10245 (+186676 bps). " +
        "$1 buy: 0.49480138 WHBAR out vs vault minimum 9.46803317 WHBAR (oracle - 300 bps): would refuse. " +
        "$1 sell: 19.609226 USDC out vs vault minimum 0.970029 USDC (oracle - 300 bps): would accept.",
    );
  });

  it("accepts both directions when the pool tracks the oracle within the slippage policy", async () => {
    const health = await poolHealth(cfg, snapshot, fakeReads(trackingPool));

    expect(Math.abs(health.deviationBps ?? Infinity)).toBeLessThanOrEqual(1);
    expect(health.buyAccepted).toBe(true);
    expect(health.sellAccepted).toBe(true);
  });

  it("refuses both directions when the policy allows less slippage than the 0.30% pool fee", async () => {
    const health = await poolHealth(cfg, snapshot, fakeReads(trackingPool, 10));

    expect(health.buyAccepted).toBe(false);
    expect(health.sellAccepted).toBe(false);
    expect(health.detail).toContain("(oracle - 10 bps)");
  });

  it("sizes each probe at $1 of the input token at the oracle price", async () => {
    const reads = fakeReads(testnetPool);
    await poolHealth(cfg, snapshot, reads);

    // $1 / $0.99997 = 1.00003 USDC and $1 / $0.10245 = 9.76085895 WHBAR, rounded down to raw units.
    expect(reads.quote).toHaveBeenCalledWith({
      tokenIn: usdc.address,
      tokenOut: whbar.address,
      fee: 3000,
      amountIn: 1_000_030n,
    });
    expect(reads.quote).toHaveBeenCalledWith({
      tokenIn: whbar.address,
      tokenOut: usdc.address,
      fee: 3000,
      amountIn: 976_085_895n,
    });
  });

  it("says when the outputs are spot-price estimates because no quoter answered", async () => {
    const health = await poolHealth(cfg, snapshot, fakeReads(testnetPool, 300, "spot"));

    expect(health.buyAccepted).toBe(false);
    expect(health.detail).toContain("$1 buy: about 0.49480138 WHBAR out at the spot price vs vault minimum");
    expect(health.detail).toContain("$1 sell: about 19.609226 USDC out at the spot price vs vault minimum");
  });

  it("reports a missing pool without quoting", async () => {
    const reads = fakeReads(null);
    const health = await poolHealth(cfg, snapshot, reads);

    expect(health).toMatchObject({
      pool: null,
      poolPriceUsd: null,
      oraclePriceUsd: 0.10245,
      deviationBps: null,
      buyAccepted: null,
      sellAccepted: null,
    });
    expect(health.detail).toBe("SaucerSwap V2 has no initialized WHBAR/USDC pool at the 0.30% fee tier.");
    expect(reads.quote).not.toHaveBeenCalled();
  });
});
