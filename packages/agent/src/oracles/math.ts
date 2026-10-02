import { formatUnits, parseUnits } from "viem";

/**
 * Integer mirror of the vault's oracle math. The agent uses it to predict exactly what the vault will compute, so
 * every function rounds down at the same steps as the Solidity code; both sides are tested against
 * packages/foundry/test/vectors/oracle-math.json. USD values and prices are 18-decimal fixed point ("E18").
 */

export const BPS = 10_000n;

/** One oracle answer as published: the raw integer and the feed's own decimals. */
export type RawPrice = { value: bigint; decimals: number };

/** What the vault records per token in `OracleReading`, minus the timestamps. */
type ReadingE18 = { priceE18: bigint; crossCheckE18: bigint; divergenceBps: bigint };

type SwapQuote = { usdValue: bigint; expectedOut: bigint; minAmountOut: bigint };

/** Rescales a positive oracle answer to 18 decimals, truncating feeds that carry more. */
export function toE18({ value, decimals }: RawPrice): bigint {
  if (value <= 0n) throw new RangeError(`oracle price must be positive, got ${value}`);
  return decimals <= 18 ? value * 10n ** BigInt(18 - decimals) : value / 10n ** BigInt(decimals - 18);
}

/** |primary - crossCheck| * 10_000 / primary, rounded down. */
export function divergenceBps(primaryE18: bigint, crossCheckE18: bigint): bigint {
  const difference = primaryE18 > crossCheckE18 ? primaryE18 - crossCheckE18 : crossCheckE18 - primaryE18;
  return (difference * BPS) / primaryE18;
}

/** The vault's reading of one token: the primary price, plus the cross-check and divergence when there is one. */
export function readingE18(primary: RawPrice, crossCheck: RawPrice | null): ReadingE18 {
  const priceE18 = toE18(primary);
  if (!crossCheck) return { priceE18, crossCheckE18: 0n, divergenceBps: 0n };
  const crossCheckE18 = toE18(crossCheck);
  return { priceE18, crossCheckE18, divergenceBps: divergenceBps(priceE18, crossCheckE18) };
}

/** USD value of `amountIn`, the oracle-fair output and the minimum the vault passes to the router. */
export function quoteSwap(args: {
  amountIn: bigint;
  decimalsIn: number;
  priceInE18: bigint;
  decimalsOut: number;
  priceOutE18: bigint;
  maxSlippageBps: number;
}): SwapQuote {
  const usdValue = (args.amountIn * args.priceInE18) / 10n ** BigInt(args.decimalsIn);
  const expectedOut = (usdValue * 10n ** BigInt(args.decimalsOut)) / args.priceOutE18;
  const minAmountOut = (expectedOut * (BPS - BigInt(args.maxSlippageBps))) / BPS;
  return { usdValue, expectedOut, minAmountOut };
}

/**
 * Token amount worth `usdE18` at `priceE18`, rounded down. Rounding down keeps the USD value the vault computes for
 * the amount at or below the requested size, so a trade sized to a cap never crosses it.
 */
export function amountForUsd(usdE18: bigint, priceE18: bigint, decimals: number): bigint {
  return (usdE18 * 10n ** BigInt(decimals)) / priceE18;
}

/** A USD amount from a strategy (a JS number) as E18; rounding to six decimals keeps float noise out of the math. */
export function usdToE18(usd: number): bigint {
  return parseUnits(usd.toFixed(6), 18);
}

export function e18ToNumber(value: bigint): number {
  return Number(formatUnits(value, 18));
}

const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const priceFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 5 });

/** An amount of money: "$25.00". */
export function formatUsd(value: number): string {
  return usdFormat.format(value);
}

/** A unit price, which needs significant digits rather than cents: "$0.10245". */
export function formatUsdPrice(value: number): string {
  return priceFormat.format(value);
}

export function formatUsdE18(value: bigint): string {
  return formatUsd(e18ToNumber(value));
}
