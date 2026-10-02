import { type NetworkName } from "../networks";
import { buildTradeProof } from "./evaluate";
import { fetchTradeEvidence } from "./fetch";
import { type TradeProof } from "./types";

/**
 * @sh/agent/verify: an independent verifier for Autonr trades that needs nothing but a public Mirror Node. The same
 * functions back `verify` on the command line and the dashboard's proof and audit pages.
 */

export { auditDecisionLog } from "./audit";
export { listDecisions } from "./decisions";
export { VerifyError, type VerifyErrorCode } from "./errors";
export { buildTradeProof, evaluateTradeEvidence, TRACE_SELECTORS } from "./evaluate";
export { fetchTradeEvidence } from "./fetch";
export { replayRejection } from "./replay";
export { listTrades } from "./trades";
export type {
  AuditFinding,
  AuditReport,
  CheckId,
  CheckStatus,
  DecisionEntry,
  HederaKey,
  ReplayResult,
  SerializedOracleReading,
  SerializedTradeReceipt,
  TokenOracleConfig,
  TraceCall,
  TradeEvidence,
  TradeProof,
  TradeSummary,
  VerificationCheck,
} from "./types";

/** Verifies one trade, by EVM transaction hash or Hedera transaction id, with the 12 checks of the proof page. */
export async function verifyTrade(input: {
  network: NetworkName;
  tx: string;
  mirrorUrl?: string;
}): Promise<TradeProof> {
  return buildTradeProof(await fetchTradeEvidence(input));
}
