import {
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionReturnType,
  decodeFunctionResult,
  type DecodeFunctionResultParameters,
  encodeFunctionData,
  type EncodeFunctionDataParameters,
  zeroAddress,
} from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { ContractCallRevertedError, type MirrorClient, MirrorNotFoundError, MirrorRequestError } from "../mirror";
import { chainlinkAggregatorAbi } from "../oracles/chainlink";
import { supraPushOracleAbi } from "../oracles/supra";
import { type ChainlinkRound, oracleReading, type SupraFeed } from "./oracle-reading";
import { type SerializedOracleReading, type TokenOracleConfig } from "./types";

type ViewCall<abi extends Abi, name extends ContractFunctionName<abi, "view">> = {
  address: Address;
  abi: abi;
  functionName: name;
  args?: ContractFunctionArgs<abi, "view", name>;
};

/**
 * Calls a view function through the Mirror Node, against the state at the end of `block`. Returns null when there is no
 * answer: the Mirror Node does not know the block yet, the call reverts, or no contract lives at the address (the call
 * then returns empty data). A check that needs the value is skipped as incomplete instead of failed. Outages (429/5xx
 * after retries) still throw.
 */
export async function readView<const abi extends Abi, name extends ContractFunctionName<abi, "view">>(
  mirror: MirrorClient,
  block: number | "latest",
  call: ViewCall<abi, name>,
): Promise<ContractFunctionReturnType<abi, "view", name> | null> {
  // viem cannot relate these parameter types to a generic ABI; ViewCall has already checked them.
  const data = encodeFunctionData({
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
  } as EncodeFunctionDataParameters);
  try {
    const result = await mirror.call({ to: call.address, data, block });
    if (result === "0x") return null;
    return decodeFunctionResult({
      abi: call.abi,
      functionName: call.functionName,
      data: result,
    } as DecodeFunctionResultParameters) as ContractFunctionReturnType<abi, "view", name>;
  } catch (error) {
    const unavailable =
      error instanceof ContractCallRevertedError ||
      error instanceof MirrorNotFoundError ||
      (error instanceof MirrorRequestError && error.status === 400);
    if (unavailable) return null;
    throw error;
  }
}

type TradeContext = {
  router: Address | null;
  supra: Address | null;
  topicNum: string | null;
  agent: Address | null;
  maxSlippageBps: number | null;
  oracleConfig: { tokenIn: TokenOracleConfig | null; tokenOut: TokenOracleConfig | null };
  oracleAtBlock: { tokenIn: SerializedOracleReading | null; tokenOut: SerializedOracleReading | null };
};

/**
 * Vault settings and oracle state as of the trade's block, re-read from chain rather than taken from the receipt. The
 * oracles are read at the network's Supra address, not the vault's: the vault-code check compares the two.
 */
export async function readTradeContext(
  mirror: MirrorClient,
  trade: { vault: Address; tokenIn: Address; tokenOut: Address; block: number; supra: Address },
): Promise<TradeContext> {
  const vault = { address: trade.vault, abi: agentVaultAbi } as const;
  const [router, supra, topicNum, agent, policy, configIn, configOut] = await Promise.all([
    readView(mirror, trade.block, { ...vault, functionName: "ROUTER" }),
    readView(mirror, trade.block, { ...vault, functionName: "SUPRA" }),
    readView(mirror, trade.block, { ...vault, functionName: "hcsTopicNum" }),
    readView(mirror, trade.block, { ...vault, functionName: "agent" }),
    readView(mirror, trade.block, { ...vault, functionName: "policy" }),
    readView(mirror, trade.block, { ...vault, functionName: "tokenConfig", args: [trade.tokenIn] }),
    readView(mirror, trade.block, { ...vault, functionName: "tokenConfig", args: [trade.tokenOut] }),
  ]);
  const oracleConfig = {
    tokenIn: configIn && toOracleConfig(configIn),
    tokenOut: configOut && toOracleConfig(configOut),
  };
  const [readingIn, readingOut] = await Promise.all([
    oracleConfig.tokenIn && readOracles(mirror, trade.block, trade.supra, oracleConfig.tokenIn),
    oracleConfig.tokenOut && readOracles(mirror, trade.block, trade.supra, oracleConfig.tokenOut),
  ]);
  return {
    router,
    supra,
    topicNum: topicNum === null ? null : topicNum.toString(),
    agent,
    maxSlippageBps: policy?.maxSlippageBps ?? null,
    oracleConfig,
    oracleAtBlock: { tokenIn: readingIn, tokenOut: readingOut },
  };
}

function toOracleConfig(config: {
  chainlinkFeed: Address;
  supraPairId: number;
  supraEnabled: boolean;
}): TokenOracleConfig {
  return {
    chainlinkFeed: config.chainlinkFeed === zeroAddress ? null : config.chainlinkFeed,
    supraPairId: config.supraEnabled ? config.supraPairId : null,
  };
}

/** Re-reads a token's configured oracles; null when any of them cannot be read at the block. */
async function readOracles(
  mirror: MirrorClient,
  block: number,
  supra: Address,
  config: TokenOracleConfig,
): Promise<SerializedOracleReading | null> {
  const [chainlink, supraFeed] = await Promise.all([
    config.chainlinkFeed ? readChainlink(mirror, block, config.chainlinkFeed) : null,
    config.supraPairId === null ? null : readSupra(mirror, block, supra, config.supraPairId),
  ]);
  const unreadable = (config.chainlinkFeed && !chainlink) || (config.supraPairId !== null && !supraFeed);
  return unreadable ? null : oracleReading(chainlink, supraFeed);
}

async function readChainlink(mirror: MirrorClient, block: number, feed: Address): Promise<ChainlinkRound | null> {
  const call = { address: feed, abi: chainlinkAggregatorAbi } as const;
  const [round, decimals] = await Promise.all([
    readView(mirror, block, { ...call, functionName: "latestRoundData" }),
    readView(mirror, block, { ...call, functionName: "decimals" }),
  ]);
  if (!round || decimals === null) return null;
  const [, answer, , updatedAt] = round;
  return { answer, updatedAt, decimals };
}

function readSupra(mirror: MirrorClient, block: number, supra: Address, pairId: number): Promise<SupraFeed | null> {
  return readView(mirror, block, {
    address: supra,
    abi: supraPushOracleAbi,
    functionName: "getSvalue",
    args: [BigInt(pairId)],
  });
}
