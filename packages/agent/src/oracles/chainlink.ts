import { type Address, parseAbi } from "viem";
import { type HederaPublicClient } from "../chain";
import { type RawPrice } from "./math";

/** The two AggregatorV3Interface functions the vault reads. */
export const chainlinkAggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

/** An oracle answer with its update time in unix seconds. */
export type Observation = RawPrice & { updatedAt: number };

/** Reads a Chainlink feed and applies the vault's validity rule: a positive answer with a non-zero update time. */
export async function readChainlink(client: HederaPublicClient, feed: Address): Promise<Observation> {
  const [[, answer, , updatedAt], decimals] = await Promise.all([
    client.readContract({ address: feed, abi: chainlinkAggregatorAbi, functionName: "latestRoundData" }),
    client.readContract({ address: feed, abi: chainlinkAggregatorAbi, functionName: "decimals" }),
  ]);
  if (answer <= 0n || updatedAt === 0n) {
    throw new Error(`Chainlink feed ${feed} has no valid answer (answer ${answer}, updatedAt ${updatedAt})`);
  }
  return { value: answer, decimals, updatedAt: Number(updatedAt) };
}
