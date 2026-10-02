import { type Address, zeroAddress } from "viem";
import { readClient } from "../chain";
import { type ReadOnlyConfig } from "../config";
import { getNetwork } from "../networks";
import { revertDataOf } from "../vault/errors";
import { factoryAbi, poolAbi, quoterV2Abi } from "./abi";
import { spotAmountOut } from "./price";

export type PoolState = {
  pool: Address;
  token0: Address;
  token1: Address;
  /** Fee tier in hundredths of a basis point (3000 = 0.30%). */
  fee: number;
  sqrtPriceX96: bigint;
  tick: number;
  /** Liquidity active at the current tick (the pool's L, not a token amount). */
  liquidity: bigint;
};

type PoolKey = { tokenA: Address; tokenB: Address; fee: number };

type QuoteArgs = { tokenIn: Address; tokenOut: Address; fee: number; amountIn: bigint };

/** What a swap through one pool pays, and how that was found out. */
export type PoolQuote = {
  amountOut: bigint;
  /** "quoter": SaucerSwap's QuoterV2 simulated the swap. "spot": estimated from the pool's price and fee. */
  source: "quoter" | "spot";
};

/** The chain reads behind a quote. The default reads Hedera over JSON-RPC; tests substitute fakes. */
export type QuoteReads = {
  quoter(args: QuoteArgs): Promise<bigint>;
  poolState(key: PoolKey): Promise<PoolState | null>;
};

/** The SaucerSwap V2 pool for a pair and fee tier, or null when none exists or it was never given a price. */
export async function getPoolState(cfg: ReadOnlyConfig, key: PoolKey): Promise<PoolState | null> {
  const client = readClient(cfg);
  const pool = await client.readContract({
    address: getNetwork(cfg.network).saucerswap.factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [key.tokenA, key.tokenB, key.fee],
  });
  if (pool === zeroAddress) return null;

  const [[sqrtPriceX96, tick], liquidity] = await Promise.all([
    client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
  ]);
  if (sqrtPriceX96 === 0n) return null;

  // The factory sorts every pair, so token0 is always the numerically lower address.
  const [token0, token1] =
    BigInt(key.tokenA) < BigInt(key.tokenB) ? [key.tokenA, key.tokenB] : [key.tokenB, key.tokenA];
  return { pool, token0, token1, fee: key.fee, sqrtPriceX96, tick, liquidity };
}

/**
 * What SaucerSwap pays for selling exactly `amountIn` of `tokenIn` through one pool. QuoterV2 simulates the swap, fee
 * and price impact included. Not every Mirror Node will run that simulation (mainnet's public one answers each QuoterV2
 * call with HTTP 429 "Invalid request", which the relay reports as a failed simulation), so a quote that fails without
 * reverting is estimated from the pool's spot price instead. A revert is SaucerSwap's own answer (no pool at this fee
 * tier, or too little liquidity) and is thrown as it is.
 */
export async function quotePool(
  cfg: ReadOnlyConfig,
  args: QuoteArgs,
  reads: QuoteReads = chainQuoteReads(cfg),
): Promise<PoolQuote> {
  try {
    return { amountOut: await reads.quoter(args), source: "quoter" };
  } catch (error) {
    if (revertDataOf(error) !== undefined) throw error;
    const state = await reads.poolState({ tokenA: args.tokenIn, tokenB: args.tokenOut, fee: args.fee });
    if (!state) throw new Error(`${missingPoolDetail(cfg)} Check AUTONR_POOL_FEE.`, { cause: error });
    return { amountOut: spotAmountOut(state, args.tokenIn, args.amountIn), source: "spot" };
  }
}

export function missingPoolDetail(cfg: ReadOnlyConfig): string {
  const pair = `${cfg.baseToken.symbol}/${cfg.quoteToken.symbol}`;
  return `SaucerSwap V2 has no initialized ${pair} pool at the ${formatFee(cfg.poolFee)} fee tier.`;
}

/** 3000 -> "0.30%": fee tiers are in hundredths of a basis point. */
export function formatFee(fee: number): string {
  return `${(fee / 10_000).toFixed(2)}%`;
}

function chainQuoteReads(cfg: ReadOnlyConfig): QuoteReads {
  return {
    quoter: async args => {
      const { result } = await readClient(cfg).simulateContract({
        address: getNetwork(cfg.network).saucerswap.quoterV2,
        abi: quoterV2Abi,
        functionName: "quoteExactInputSingle",
        args: [{ ...args, sqrtPriceLimitX96: 0n }],
      });
      return result[0];
    },
    poolState: key => getPoolState(cfg, key),
  };
}
