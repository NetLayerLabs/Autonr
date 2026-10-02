import { type Address, formatUnits, isAddressEqual } from "viem";
import { type TokenRef } from "../networks";
import { type PoolState } from "./pool";

const Q192 = 1n << 192n;

/** Fee tiers are in hundredths of a basis point: 3000 / 1_000_000 = 0.30%. */
export const FEE_UNITS = 1_000_000n;

/**
 * Price of one whole `base` token in whole `quote` tokens, as 18-decimal fixed point (the E18 convention of the
 * oracle math, so pool and oracle prices compare directly).
 *
 * A pool stores sqrt(token1 / token0) over raw units as a Q64.96 number, so the raw price is sqrtPriceX96^2 / 2^192;
 * the decimals turn raw units into whole tokens. Dividing last keeps the result exact up to one final rounding.
 */
export function poolPriceE18(state: PoolState, base: TokenRef, quote: TokenRef): bigint {
  const baseIsToken0 = isAddressEqual(state.token0, base.address) && isAddressEqual(state.token1, quote.address);
  const baseIsToken1 = isAddressEqual(state.token1, base.address) && isAddressEqual(state.token0, quote.address);
  if (!baseIsToken0 && !baseIsToken1) {
    throw new Error(`pool ${state.pool} does not trade ${base.symbol}/${quote.symbol}`);
  }
  const ratioX192 = state.sqrtPriceX96 * state.sqrtPriceX96;
  const [numerator, denominator] = baseIsToken0 ? [ratioX192, Q192] : [Q192, ratioX192];
  return (numerator * 10n ** BigInt(base.decimals + 18)) / (denominator * 10n ** BigInt(quote.decimals));
}

/** USD price of `base` implied by the pool, given the oracle's USD price of `quote`. */
export function poolPriceUsd(state: PoolState, base: TokenRef, quote: TokenRef, quoteUsd: number): number {
  return Number(formatUnits(poolPriceE18(state, base, quote), 18)) * quoteUsd;
}

/**
 * What the pool pays for `amountIn` of `tokenIn` at its current price, after the LP fee and without price impact:
 * exact for a trade too small to move the price, optimistic for a larger one.
 */
export function spotAmountOut(state: PoolState, tokenIn: Address, amountIn: bigint): bigint {
  const ratioX192 = state.sqrtPriceX96 * state.sqrtPriceX96;
  const gross = isAddressEqual(tokenIn, state.token0) ? (amountIn * ratioX192) / Q192 : (amountIn * Q192) / ratioX192;
  return (gross * (FEE_UNITS - BigInt(state.fee))) / FEE_UNITS;
}
