import { type Address, decodeEventLog, getAbiItem, type Hex, toEventSelector } from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { type SerializedOracleReading, type SerializedTradeReceipt } from "./types";

const TRADE_EXECUTED = toEventSelector(getAbiItem({ abi: agentVaultAbi, name: "TradeExecuted" }));

type DecodedTrade = { tradeId: number; tokenIn: Address; tokenOut: Address; receipt: SerializedTradeReceipt };

/**
 * Decodes a log as AgentVault's TradeExecuted event, or returns null for any other event. Any contract can emit a log
 * with this signature, so one whose topics or data do not decode is skipped as not a trade rather than crashing.
 */
export function decodeTradeExecuted(log: { data: Hex | null; topics: Hex[] }): DecodedTrade | null {
  const [signature, ...indexed] = log.topics;
  if (signature?.toLowerCase() !== TRADE_EXECUTED) return null;
  let args;
  try {
    ({ args } = decodeEventLog({
      abi: agentVaultAbi,
      eventName: "TradeExecuted",
      data: log.data ?? "0x",
      topics: [signature, ...indexed],
    }));
  } catch {
    return null;
  }
  const { receipt } = args;
  return {
    tradeId: Number(args.tradeId),
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    receipt: {
      amountIn: receipt.amountIn.toString(),
      amountOut: receipt.amountOut.toString(),
      minAmountOut: receipt.minAmountOut.toString(),
      usdValue: receipt.usdValue.toString(),
      oracleIn: serializeReading(receipt.oracleIn),
      oracleOut: serializeReading(receipt.oracleOut),
      reasoningHash: receipt.reasoningHash,
      hcsTopicNum: receipt.hcsTopicNum.toString(),
      hcsSequence: Number(receipt.hcsSequence),
    },
  };
}

function serializeReading(reading: {
  priceE18: bigint;
  updatedAt: bigint;
  crossCheckE18: bigint;
  crossCheckUpdatedAt: bigint;
  divergenceBps: bigint;
}): SerializedOracleReading {
  return {
    priceE18: reading.priceE18.toString(),
    updatedAt: Number(reading.updatedAt),
    crossCheckE18: reading.crossCheckE18.toString(),
    crossCheckUpdatedAt: Number(reading.crossCheckUpdatedAt),
    divergenceBps: Number(reading.divergenceBps),
  };
}
