import { type Address, type Hex } from "viem";
import { type DecisionRecord } from "../decision";
import { type NetworkName } from "../networks";

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export type CheckId =
  | "tx-success"
  | "vault-code"
  | "topic-pinned"
  | "message-found"
  | "hash-match"
  | "ordering"
  | "same-key"
  | "schema-valid"
  | "content-match"
  | "oracle-match"
  | "atomic-trace"
  | "execution-quality";

export type VerificationCheck = {
  id: CheckId;
  title: string;
  status: CheckStatus;
  detail: string;
  evidence?: Record<string, string>;
};

/** IAgentVault.OracleReading with uint256 prices as decimal strings and times as unix seconds. */
export type SerializedOracleReading = {
  priceE18: string;
  updatedAt: number;
  crossCheckE18: string;
  crossCheckUpdatedAt: number;
  divergenceBps: number;
};

export type SerializedTradeReceipt = {
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  usdValue: string;
  oracleIn: SerializedOracleReading;
  oracleOut: SerializedOracleReading;
  reasoningHash: Hex;
  hcsTopicNum: string;
  hcsSequence: number;
};

/** A Hedera public key as the Mirror Node reports it (`type` is ECDSA_SECP256K1, ED25519 or ProtobufEncoded). */
export type HederaKey = { type: string; key: string };

/** Which oracles the vault reads for one token, from `vault.tokenConfig(token)`. */
export type TokenOracleConfig = {
  chainlinkFeed: Address | null;
  /** Null when Supra is disabled for the token. */
  supraPairId: number | null;
};

/** One call frame of the trade transaction, from the Mirror Node's contract actions. */
export type TraceCall = {
  depth: number;
  /** Known contracts (vault, oracles) use their EVM address; anything else keeps the Mirror Node's long-zero form. */
  caller: Address;
  to: Address;
  selector: Hex;
  resultOk: boolean;
};

/**
 * Everything the verifier needs about one trade, gathered from public Mirror Node data by `fetchTradeEvidence`.
 * `evaluateTradeEvidence` turns it into checks without any I/O, so evidence can be mutated and re-checked in a browser.
 * A null field means the Mirror Node could not provide it; checks that need it are skipped, never failed.
 */
export type TradeEvidence = {
  network: NetworkName;
  txHash: Hex;
  transactionId: string | null;
  consensusTimestamp: string;
  blockNumber: number | null;
  /** Mirror Node result code of the transaction, e.g. "SUCCESS". */
  result: string;
  /** Sender as served by the Mirror Node: the long-zero address of the sending account. */
  from: Address | null;
  vault: Address;
  /** Runtime bytecode of the contract that emitted TradeExecuted, as the Mirror Node serves it. */
  vaultCode: Hex | null;
  /** vault.ROUTER() and vault.SUPRA() at the trade's block: the immutables a genuine AgentVault was deployed with. */
  vaultRouterAtBlock: Address | null;
  vaultSupraAtBlock: Address | null;
  tradeId: number;
  tokenIn: Address;
  tokenOut: Address;
  receipt: SerializedTradeReceipt;
  /** SaucerSwap fee tier from the executeSwap calldata; null when the transaction did not call executeSwap directly. */
  poolFee: number | null;
  /**
   * amountIn from the executeSwap calldata; null like `poolFee`. The receipt's amountIn is what the router actually
   * took, which is less only when the pool ran out of liquidity mid-swap.
   */
  requestedAmountIn: string | null;
  vaultTopicNumAtBlock: string | null;
  vaultAgentAtBlock: Address | null;
  /** The Hedera account behind `vaultAgentAtBlock`, as of the trade. */
  agentAccount: { accountId: string; evmAddress: Address | null; key: HederaKey | null } | null;
  message: {
    /** Base64 of the exact message bytes, as served by the Mirror Node. This is what the vault's hash commits to. */
    raw: string;
    consensusTimestamp: string;
    payer: string;
    /** The topic's current submit key; the Mirror Node does not serve historical topic keys. */
    topicSubmitKey: HederaKey | null;
  } | null;
  /** Oracle readings recomputed from the configured oracles' state at the trade's block. */
  oracleAtBlock: { tokenIn: SerializedOracleReading | null; tokenOut: SerializedOracleReading | null } | null;
  oracleConfigAtBlock: { tokenIn: TokenOracleConfig | null; tokenOut: TokenOracleConfig | null } | null;
  trace: TraceCall[] | null;
  policyMaxSlippageBps: number | null;
};

export type TradeProof = {
  network: NetworkName;
  txHash: Hex;
  transactionId: string | null;
  consensusTimestamp: string;
  blockNumber: number | null;
  vault: Address;
  tradeId: number;
  tokenIn: Address;
  tokenOut: Address;
  receipt: SerializedTradeReceipt;
  topicId: string;
  sequence: number;
  messageConsensusTimestamp: string | null;
  decision: DecisionRecord | null;
  decisionJson: string | null;
  links: { tx: string; topicMessage: string; vault: string };
  checks: VerificationCheck[];
  verdict: "verified" | "failed" | "incomplete";
};

export type TradeSummary = {
  txHash: Hex;
  consensusTimestamp: string;
  tradeId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  usdValue: string;
  hcsSequence: number;
};

export type DecisionEntry = {
  sequence: number;
  consensusTimestamp: string;
  payer: string;
  /** keccak256 of the exact message bytes, comparable with a trade's reasoningHash. */
  hash: Hex;
  record: DecisionRecord | null;
  /** Why the message is not a valid decision record, or null. */
  error: string | null;
  /** The message decoded as UTF-8 text. */
  raw: string;
};

export type ReplayResult = {
  sequence: number;
  expectedError: string;
  replayedError: string | null;
  reproduced: boolean;
  detail: string;
};

export type AuditFinding = { severity: "error" | "warning"; message: string };

export type AuditReport = {
  network: NetworkName;
  vault: Address;
  topicId: string;
  fromSequence: number;
  toSequence: number;
  decisions: { trade: number; hold: number; rejected: number; invalid: number; foreignPayer: number };
  trades: number;
  matchedTrades: number;
  unmatchedTrades: TradeSummary[];
  tradeRecordsWithoutOutcome: number[];
  findings: AuditFinding[];
  ok: boolean;
};
