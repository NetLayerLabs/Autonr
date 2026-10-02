import type {
  AgentConfig,
  ManualAction,
  MarketSnapshot,
  NetworkName,
  RedTeamResult,
  TickResult,
  TokenRef,
  VaultState,
} from "@sh/agent";
import type {
  AuditReport,
  DecisionEntry,
  ReplayResult,
  TradeEvidence,
  TradeProof,
  TradeSummary,
} from "@sh/agent/verify";
import type { Address } from "viem";

/**
 * Response bodies of the dashboard's API routes and the domain types they carry. Type-only, so client components can
 * share them without bundling any server code.
 */

export type { DecisionKind, DecisionRecord, Rejection } from "@sh/agent/decision";
export type {
  MarketSnapshot,
  OracleSnapshot,
  RedTeamResult,
  RedTeamScenario,
  TickResult,
  VaultPolicy,
  VaultState,
  VaultToken,
} from "@sh/agent";
export type {
  AuditReport,
  CheckStatus,
  DecisionEntry,
  ReplayResult,
  SerializedOracleReading,
  TradeEvidence,
  TradeProof,
  TradeSummary,
  VerificationCheck,
} from "@sh/agent/verify";

/** Sent with HTTP 200 when a panel needs configuration that is missing. */
export type NotConfigured = { configured: false; reason: string; commands: string[] };

/** Body of every 4xx and 502 response. */
export type ApiErrorBody = { error: string };

export type AgentStatus =
  | {
      ready: true;
      strategy: AgentConfig["strategy"];
      targetBaseWeight: number;
      tradeUsd: number;
      llmModel: string | null;
    }
  | { ready: false; missing: string[] };

export type HealthResponse = {
  network: NetworkName;
  vaultAddress: Address | null;
  topicId: string | null;
  agentAccountId: string | null;
  agentAddress: Address | null;
  baseToken: TokenRef;
  quoteToken: TokenRef;
  poolFee: number;
  tickApiEnabled: boolean;
  /** Whether POST /api/agent/tick also expects the x-autonr-secret header. */
  tickApiSecretRequired: boolean;
  agent: AgentStatus;
};

/** The snapshot plus the oracle contracts behind it, for links. */
export type MarketResponse = {
  network: NetworkName;
  snapshot: MarketSnapshot;
  base: TokenRef;
  quote: TokenRef;
  supra: Address;
};

export type VaultResponse = NotConfigured | { configured: true; network: NetworkName; vault: VaultState };

export type DecisionsResponse =
  | NotConfigured
  | { configured: true; network: NetworkName; topicId: string; decisions: DecisionEntry[] };

export type TradesResponse =
  | NotConfigured
  | { configured: true; network: NetworkName; vault: Address; trades: TradeSummary[] };

export type ProofResponse = { proof: TradeProof; evidence: TradeEvidence };

export type AuditResponse = NotConfigured | { configured: true; report: AuditReport };

export type ReplayResponse = NotConfigured | { configured: true; result: ReplayResult };

export type RedTeamResponse = NotConfigured | { configured: true; result: RedTeamResult };

export type TickRequest = { dryRun?: boolean; manual?: ManualAction };

export type TickResponse = NotConfigured | { configured: true; result: TickResult };
