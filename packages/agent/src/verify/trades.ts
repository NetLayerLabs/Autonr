import { type Address, type Hex } from "viem";
import { type MirrorClient } from "../mirror";
import { type NetworkName } from "../networks";
import { VerifyError } from "./errors";
import { addressInput, DEFAULT_LIST_LIMIT, limitInput, mirrorFor } from "./input";
import { decodeTradeExecuted } from "./receipt";
import { type TradeSummary } from "./types";

/**
 * An AgentVault emits one event per trade and a handful per owner action, so a contract with this many other events
 * before the next trade is not a vault; stopping beats paging through a busy contract's whole history.
 */
const MAX_SCANNED_LOGS = 2_000;

/** A TradeExecuted event with the fields the audit matches against the decision log. */
export type TradeEvent = TradeSummary & { reasoningHash: Hex; hcsTopicNum: string };

/** The vault's latest trades, newest first, from its TradeExecuted events. An address without a contract has none. */
export async function listTrades(input: {
  network: NetworkName;
  vault: Address;
  limit?: number;
  mirrorUrl?: string;
}): Promise<TradeSummary[]> {
  const vault = addressInput(input.vault, "vault");
  const limit = limitInput(input.limit, DEFAULT_LIST_LIMIT);
  const trades: TradeSummary[] = [];
  for await (const trade of tradeEvents(mirrorFor(input.network, input.mirrorUrl), vault)) {
    trades.push(toSummary(trade));
    if (trades.length === limit) break;
  }
  return trades;
}

/** TradeExecuted events of `vault` (optionally only from `since` on), newest first, fetched lazily page by page. */
export async function* tradeEvents(mirror: MirrorClient, vault: Address, since?: string): AsyncGenerator<TradeEvent> {
  let scanned = 0;
  for await (const log of mirror.contractLogs(vault, since)) {
    scanned += 1;
    if (scanned > MAX_SCANNED_LOGS) {
      const reason = `stopped after ${MAX_SCANNED_LOGS} events of ${vault} without reaching the trades requested`;
      throw new VerifyError("invalid-input", `${reason}; is it an AgentVault?`);
    }
    const trade = decodeTradeExecuted(log);
    if (!trade) continue;
    const { receipt } = trade;
    yield {
      txHash: log.transaction_hash,
      consensusTimestamp: log.timestamp,
      tradeId: trade.tradeId,
      tokenIn: trade.tokenIn,
      tokenOut: trade.tokenOut,
      amountIn: receipt.amountIn,
      amountOut: receipt.amountOut,
      minAmountOut: receipt.minAmountOut,
      usdValue: receipt.usdValue,
      hcsSequence: receipt.hcsSequence,
      reasoningHash: receipt.reasoningHash,
      hcsTopicNum: receipt.hcsTopicNum,
    };
  }
}

export function toSummary({ reasoningHash: _hash, hcsTopicNum: _topic, ...summary }: TradeEvent): TradeSummary {
  return summary;
}
