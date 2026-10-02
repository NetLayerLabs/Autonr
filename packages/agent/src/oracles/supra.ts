import { type Address, parseAbi } from "viem";
import { type HederaPublicClient } from "../chain";
import { type Observation } from "./chainlink";

/** Supra's push oracle; each pair carries its own decimals (HBAR_USDT 18, USDC_USD 8). */
export const supraPushOracleAbi = parseAbi([
  "struct PriceFeed { uint256 round; uint256 decimals; uint256 time; uint256 price; }",
  "function getSvalue(uint256 pairIndex) view returns (PriceFeed)",
]);

const MILLISECOND_TIMESTAMPS = 10n ** 12n;

/**
 * Supra's push oracle on Hedera reports `time` in milliseconds while everything else (Chainlink, the vault, block
 * time) uses seconds. Values above 1e12 are milliseconds; the vault applies the same rule.
 */
export function supraTimeToSeconds(time: bigint): number {
  return Number(time > MILLISECOND_TIMESTAMPS ? time / 1000n : time);
}

export async function readSupra(client: HederaPublicClient, oracle: Address, pairId: number): Promise<Observation> {
  const feed = await client.readContract({
    address: oracle,
    abi: supraPushOracleAbi,
    functionName: "getSvalue",
    args: [BigInt(pairId)],
  });
  if (feed.price === 0n) throw new Error(`Supra pair ${pairId} on ${oracle} has no price`);
  return { value: feed.price, decimals: Number(feed.decimals), updatedAt: supraTimeToSeconds(feed.time) };
}
