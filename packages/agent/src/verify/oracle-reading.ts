import { type RawPrice, readingE18 } from "../oracles/math";
import { supraTimeToSeconds } from "../oracles/supra";
import { type SerializedOracleReading } from "./types";

export type ChainlinkRound = { answer: bigint; updatedAt: bigint; decimals: number };
export type SupraFeed = { price: bigint; decimals: bigint; time: bigint };

/**
 * Recomputes IAgentVault.OracleReading from raw oracle values with the vault's pricing rule, so the verifier checks the
 * receipt against the oracles themselves rather than against the vault's own arithmetic. `chainlink` is null for a
 * token without a feed and `supra` is null when Supra is disabled for it: with both, Chainlink prices and Supra
 * cross-checks; with one, it prices alone. Returns null when a configured source has no positive price, which the
 * vault would have refused with InvalidOraclePrice.
 */
export function oracleReading(
  chainlink: ChainlinkRound | null,
  supra: SupraFeed | null,
): SerializedOracleReading | null {
  if ((chainlink && chainlink.answer <= 0n) || (supra && supra.price === 0n)) return null;
  const supraPrice: RawPrice | null = supra && { value: supra.price, decimals: Number(supra.decimals) };
  const primary: RawPrice | null = chainlink ? { value: chainlink.answer, decimals: chainlink.decimals } : supraPrice;
  if (!primary) return null;
  const reading = readingE18(primary, chainlink ? supraPrice : null);
  const supraUpdatedAt = supra ? supraTimeToSeconds(supra.time) : 0;
  return {
    priceE18: reading.priceE18.toString(),
    updatedAt: chainlink ? Number(chainlink.updatedAt) : supraUpdatedAt,
    crossCheckE18: reading.crossCheckE18.toString(),
    crossCheckUpdatedAt: chainlink ? supraUpdatedAt : 0,
    divergenceBps: Number(reading.divergenceBps),
  };
}
