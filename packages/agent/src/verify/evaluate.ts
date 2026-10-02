import { type Address, formatUnits, type Hex, keccak256, size, toFunctionSelector } from "viem";
import { agentVaultImmutableReferences, agentVaultRuntimeBytecode } from "../abi/agentVaultCode";
import { DECISION_SCHEMA_ID, type DecodedDecision, decodeDecision } from "../decision";
import {
  compareConsensusTimestamps,
  entityIdFromLongZero,
  entityIdFromNum,
  hashscanTopicMessageUrl,
  hashscanUrl,
} from "../hedera";
import { getNetwork, type NetworkName, type TokenRef } from "../networks";
import {
  type CheckId,
  type CheckStatus,
  type HederaKey,
  type SerializedOracleReading,
  type TokenOracleConfig,
  type TradeEvidence,
  type TradeProof,
  type VerificationCheck,
} from "./types";

/**
 * The verifier's rules. Everything here is pure and browser-safe (no I/O, no Node APIs), so the dashboard can mutate
 * evidence and re-run the checks client-side, and anyone can audit exactly what "verified" means.
 */

export type {
  CheckId,
  CheckStatus,
  HederaKey,
  SerializedOracleReading,
  SerializedTradeReceipt,
  TokenOracleConfig,
  TraceCall,
  TradeEvidence,
  TradeProof,
  VerificationCheck,
} from "./types";

/** Selectors the trade's call trace must show: both oracle reads, then the swap. */
export const TRACE_SELECTORS = {
  chainlinkLatestRoundData: toFunctionSelector("latestRoundData()"),
  supraGetSvalue: toFunctionSelector("getSvalue(uint256)"),
  saucerswapExactInput: toFunctionSelector("exactInput((bytes,address,uint256,uint256,uint256))"),
} as const;

const TITLES: Record<CheckId, string> = {
  "tx-success": "Trade transaction succeeded",
  "vault-code": "Emitter is a genuine AgentVault",
  "topic-pinned": "Receipt names the vault's decision topic",
  "message-found": "Decision message exists",
  "hash-match": "Message bytes match the committed hash",
  ordering: "Decision published before the trade",
  "same-key": "One key signed the decision and the trade",
  "schema-valid": "Decision is a valid trade record",
  "content-match": "Decision matches the executed trade",
  "oracle-match": "Oracle readings match the chain",
  "atomic-trace": "Oracles read before the swap, in one transaction",
  "execution-quality": "Execution within the slippage policy",
};

/** Exact bytes of a base64 HCS message, decoded without Buffer so this module runs in browsers. */
export function messageBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

/** The message as UTF-8 text, for display. Hashes are always taken over the bytes. */
export function messageText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function evaluateTradeEvidence(evidence: TradeEvidence): {
  checks: VerificationCheck[];
  verdict: TradeProof["verdict"];
} {
  return evaluate(contextOf(evidence));
}

/** The full proof for a trade: the checks plus what the agent said and where to see it on HashScan. */
export function buildTradeProof(evidence: TradeEvidence): TradeProof {
  const context = contextOf(evidence);
  const { network, txHash, vault, receipt, message } = evidence;
  return {
    network,
    txHash,
    transactionId: evidence.transactionId,
    consensusTimestamp: evidence.consensusTimestamp,
    blockNumber: evidence.blockNumber,
    vault,
    tradeId: evidence.tradeId,
    tokenIn: evidence.tokenIn,
    tokenOut: evidence.tokenOut,
    receipt,
    topicId: context.topicId,
    sequence: receipt.hcsSequence,
    messageConsensusTimestamp: message?.consensusTimestamp ?? null,
    decision: context.decoded?.ok ? context.decoded.record : null,
    decisionJson: context.bytes && messageText(context.bytes),
    links: {
      tx: hashscanUrl(network, "transaction", txHash),
      topicMessage: hashscanTopicMessageUrl(network, context.topicId, receipt.hcsSequence, message?.consensusTimestamp),
      vault: hashscanUrl(network, "contract", vault),
    },
    ...evaluate(context),
  };
}

type Context = {
  evidence: TradeEvidence;
  topicId: string;
  /** "block 123", for details. */
  block: string;
  /** Message bytes; null without a message or when the evidence carries malformed base64. */
  bytes: Uint8Array | null;
  decoded: DecodedDecision | null;
};

function contextOf(evidence: TradeEvidence): Context {
  const bytes = evidence.message && decodeRaw(evidence.message.raw);
  return {
    evidence,
    topicId: entityIdFromNum(BigInt(evidence.receipt.hcsTopicNum)),
    block: evidence.blockNumber === null ? "the trade's block" : `block ${evidence.blockNumber}`,
    bytes,
    decoded: bytes && decodeDecision(bytes),
  };
}

/** Evidence may be edited by hand (the dashboard's tamper lab), so malformed base64 is a finding, not a crash. */
function decodeRaw(raw: string): Uint8Array | null {
  try {
    return messageBytes(raw);
  } catch {
    return null;
  }
}

function evaluate(context: Context): { checks: VerificationCheck[]; verdict: TradeProof["verdict"] } {
  const checks = [
    txSuccess(context),
    vaultCode(context),
    topicPinned(context),
    messageFound(context),
    hashMatch(context),
    ordering(context),
    sameKey(context),
    schemaValid(context),
    contentMatch(context),
    oracleMatch(context),
    atomicTrace(context),
    executionQuality(context),
  ];
  const worst = worstStatus(checks.map(check => check.status));
  // A skip always means some evidence was unavailable; a warning is informative and does not block a verdict.
  const verdict = worst === "fail" ? "failed" : worst === "skip" ? "incomplete" : "verified";
  return { checks, verdict };
}

function worstStatus(statuses: CheckStatus[]): CheckStatus {
  const severity: CheckStatus[] = ["fail", "skip", "warn", "pass"];
  return severity.find(status => statuses.includes(status)) ?? "pass";
}

function check(id: CheckId, status: CheckStatus, detail: string, evidence?: Record<string, string>): VerificationCheck {
  return { id, title: TITLES[id], status, detail, ...(evidence && { evidence }) };
}

function txSuccess({ evidence }: Context): VerificationCheck {
  if (evidence.result !== "SUCCESS") {
    return check("tx-success", "fail", `the transaction ended with ${evidence.result}`);
  }
  const detail = `vault ${evidence.vault} executed trade #${evidence.tradeId} and emitted TradeExecuted`;
  return check("tx-success", "pass", detail);
}

/**
 * Zeroes the byte ranges the deployment fills with immutables (ROUTER, SUPRA), so deployed code compares equal to the
 * compiled code it came from. Lowercase hex without 0x; code of another length is returned unmasked.
 */
function maskImmutables(code: Hex): string {
  let hex = code.toLowerCase().slice(2);
  if (hex.length !== agentVaultRuntimeBytecode.length - 2) return hex;
  for (const { start, length } of agentVaultImmutableReferences) {
    hex = `${hex.slice(0, start * 2)}${"0".repeat(length * 2)}${hex.slice((start + length) * 2)}`;
  }
  return hex;
}

const EXPECTED_VAULT_CODE = maskImmutables(agentVaultRuntimeBytecode);

/**
 * Any contract can emit a log shaped like TradeExecuted, and every other check reads the emitter's own views. So the
 * emitter must run exactly the AgentVault code this verifier was built from, deployed against the network's router
 * and Supra oracle: only then do its views and events carry the vault's guarantees.
 */
function vaultCode({ evidence, block }: Context): VerificationCheck {
  const { vault, vaultCode: code, network } = evidence;
  if (!code) return check("vault-code", "skip", `the Mirror Node has no runtime bytecode for ${vault} yet`);
  const codeBytes = size(code);
  if (maskImmutables(code) !== EXPECTED_VAULT_CODE) {
    const expectedBytes = size(agentVaultRuntimeBytecode);
    const detail = `${vault} does not run AgentVault's code: its ${codeBytes}-byte runtime bytecode differs from the ${expectedBytes} bytes compiled from packages/foundry, so its events prove nothing`;
    return check("vault-code", "fail", detail);
  }
  const router = evidence.vaultRouterAtBlock;
  const supra = evidence.vaultSupraAtBlock;
  if (!router || !supra) {
    return check("vault-code", "skip", `could not re-read vault.ROUTER() and vault.SUPRA() at ${block}`);
  }
  const expected = getNetwork(network);
  const wiring = { runtimeBytes: String(codeBytes), router, supra };
  const miswired = [
    !sameAddress(router, expected.saucerswap.router) &&
      `ROUTER() is ${router}, not ${network}'s SaucerSwap router ${expected.saucerswap.router}`,
    !sameAddress(supra, expected.supra) && `SUPRA() is ${supra}, not ${network}'s Supra oracle ${expected.supra}`,
  ].filter(difference => typeof difference === "string");
  if (miswired.length > 0) return check("vault-code", "fail", miswired.join("; "), wiring);
  const detail = `${vault} runs AgentVault's compiled code (${codeBytes} bytes, immutables masked), wired to ${network}'s SaucerSwap router and Supra oracle`;
  return check("vault-code", "pass", detail, wiring);
}

function topicPinned({ evidence, topicId, block }: Context): VerificationCheck {
  const pinned = evidence.vaultTopicNumAtBlock;
  if (pinned === null) return check("topic-pinned", "skip", `could not re-read vault.hcsTopicNum() at ${block}`);
  if (pinned === evidence.receipt.hcsTopicNum) {
    return check("topic-pinned", "pass", `topic ${topicId} was the vault's decision topic at ${block}`);
  }
  const actual = entityIdFromNum(BigInt(pinned));
  const detail = `the receipt names topic ${topicId}, but at ${block} the vault's topic was ${actual}`;
  return check("topic-pinned", "fail", detail);
}

function messageFound({ evidence, topicId }: Context): VerificationCheck {
  const sequence = evidence.receipt.hcsSequence;
  if (!evidence.message) {
    return check("message-found", "fail", `topic ${topicId} has no message with sequence ${sequence}`);
  }
  return check("message-found", "pass", `message ${sequence} on topic ${topicId}, paid by ${evidence.message.payer}`, {
    topicId,
    sequence: String(sequence),
    consensusTimestamp: evidence.message.consensusTimestamp,
  });
}

function hashMatch({ evidence, bytes }: Context): VerificationCheck {
  if (!evidence.message) return check("hash-match", "skip", "there is no message to hash");
  if (!bytes) return check("hash-match", "fail", "the message is not valid base64, so its bytes cannot be hashed");
  const actual = keccak256(bytes);
  const committed = evidence.receipt.reasoningHash;
  const hashes = { messageHash: actual, reasoningHash: committed };
  if (actual.toLowerCase() !== committed.toLowerCase()) {
    const detail = `keccak256 of the message is ${short(actual)}, but the vault committed to ${short(committed)}`;
    return check("hash-match", "fail", detail, hashes);
  }
  const detail = `keccak256 of the ${bytes.length} message bytes is ${short(actual)}, as committed`;
  return check("hash-match", "pass", detail, hashes);
}

function ordering({ evidence }: Context): VerificationCheck {
  if (!evidence.message) return check("ordering", "skip", "there is no message to order");
  const published = evidence.message.consensusTimestamp;
  const traded = evidence.consensusTimestamp;
  const times = { messageConsensusTimestamp: published, tradeConsensusTimestamp: traded };
  const order = compareConsensusTimestamps(published, traded);
  if (order === 0) return check("ordering", "fail", "the message and the trade share one consensus timestamp", times);
  if (order > 0) {
    return check("ordering", "fail", `the message was published ${gap(traded, published)} after the trade`, times);
  }
  const before = gap(published, traded);
  return check("ordering", "pass", `published ${before} before the trade reached consensus`, { ...times, gap: before });
}

function sameKey({ evidence, topicId, block }: Context): VerificationCheck {
  const { message, agentAccount: agent } = evidence;
  if (!message) return check("same-key", "skip", "there is no message whose signer to compare");
  const submitKey = message.topicSubmitKey;
  if (!submitKey) {
    return check("same-key", "fail", `topic ${topicId} has no submit key, so anyone could have published this message`);
  }
  if (submitKey.type !== "ECDSA_SECP256K1") {
    const reason = "only an ECDSA_SECP256K1 key can also sign the agent's EVM transactions";
    return check("same-key", "fail", `topic ${topicId}'s submit key is ${submitKey.type}; ${reason}`);
  }
  if (!evidence.vaultAgentAtBlock || !agent) {
    return check("same-key", "skip", `could not resolve vault.agent() at ${block} to a Hedera account`);
  }
  const keys = {
    submitKey: submitKey.key,
    agentAccount: agent.accountId,
    agentAddress: evidence.vaultAgentAtBlock,
    agentKey: agent.key?.key ?? "none",
    tradeSender: evidence.from ?? "unknown",
    messagePayer: message.payer,
  };
  if (!agent.key || !sameHederaKey(agent.key, submitKey)) {
    const agentKey = agent.key ? `whose key is ${short(agent.key.key)}` : "which has no key";
    const holder = `the vault's agent ${agent.accountId}, ${agentKey}`;
    const detail = `topic ${topicId}'s submit key ${short(submitKey.key)} is not held by ${holder}`;
    return check("same-key", "fail", detail, keys);
  }
  if (!evidence.from || !isAccount(evidence.from, agent)) {
    const sender = evidence.from ?? "an unknown account";
    const detail = `the trade was sent by ${sender}, not by the vault's agent ${agent.accountId}`;
    return check("same-key", "fail", detail, keys);
  }
  if (message.payer !== agent.accountId) {
    const detail = `the message was paid for by ${message.payer}, not by the agent ${agent.accountId}`;
    return check("same-key", "fail", detail, keys);
  }
  const holder = `agent ${agent.accountId} holds topic ${topicId}'s submit key ${short(submitKey.key)}`;
  return check("same-key", "pass", `${holder}, sent the trade and paid for the message`, keys);
}

function schemaValid({ evidence, bytes, decoded }: Context): VerificationCheck {
  if (!evidence.message) return check("schema-valid", "skip", "there is no message to validate");
  if (!bytes || !decoded) return check("schema-valid", "fail", "the message is not valid base64");
  if (!decoded.ok) {
    const reason = decoded.error.replace(/\s*\n\s*/g, "; ");
    return check("schema-valid", "fail", `not a ${DECISION_SCHEMA_ID} record: ${reason}`);
  }
  const { kind, strategy } = decoded.record;
  if (kind !== "trade") {
    return check("schema-valid", "fail", `the message is a "${kind}" record; a trade must point at a "trade" record`);
  }
  const detail = `${DECISION_SCHEMA_ID} trade record from strategy ${strategy.id} ${strategy.version}`;
  return check("schema-valid", "pass", detail);
}

function contentMatch({ evidence, decoded }: Context): VerificationCheck {
  const record = decoded?.ok ? decoded.record : null;
  if (record?.kind !== "trade" || !record.action) {
    return check("content-match", "skip", "there is no valid trade record to compare");
  }
  const { action } = record;
  const { network, vault, tokenIn, tokenOut, receipt, poolFee } = evidence;
  // The vault can sell less than requested (a partial fill) but never more, so the record must match the request and
  // the receipt may only fall short of it.
  const requested = evidence.requestedAmountIn ?? receipt.amountIn;
  const differences = [
    record.network !== network && `network: record ${record.network}, trade ${network}`,
    !sameAddress(record.vault, vault) && `vault: record ${record.vault}, trade ${vault}`,
    !sameAddress(action.tokenIn, tokenIn) && `tokenIn: record ${action.tokenIn}, trade ${tokenIn}`,
    !sameAddress(action.tokenOut, tokenOut) && `tokenOut: record ${action.tokenOut}, trade ${tokenOut}`,
    BigInt(action.amountIn) !== BigInt(requested) && `amountIn: record ${action.amountIn}, trade ${requested}`,
    BigInt(receipt.amountIn) > BigInt(requested) &&
      `amountIn: the vault reports selling ${receipt.amountIn}, more than the ${requested} requested`,
    poolFee !== null && action.poolFee !== poolFee && `poolFee: record ${action.poolFee}, trade ${poolFee}`,
  ].filter(difference => typeof difference === "string");
  if (differences.length > 0) {
    return check("content-match", "fail", `the record differs from the executed trade (${differences.join("; ")})`);
  }
  const sold = formatAmount(network, tokenIn, receipt.amountIn);
  const summary = `${action.side} ${sold} for ${tokenLabel(network, tokenOut)}`;
  if (BigInt(receipt.amountIn) < BigInt(requested)) {
    const partial = `the pool filled only ${sold} of the ${formatAmount(network, tokenIn, requested)} requested`;
    return check("content-match", "warn", `${summary} as recorded, but ${partial}`);
  }
  if (poolFee === null) {
    const caveat = "the fee tier is unverified because the transaction did not call executeSwap directly";
    return check("content-match", "warn", `${summary} as recorded; ${caveat}`);
  }
  return check("content-match", "pass", `${summary} in the ${poolFee} fee tier, as recorded`);
}

const READING_FIELDS = ["priceE18", "updatedAt", "crossCheckE18", "crossCheckUpdatedAt", "divergenceBps"] as const;

function oracleMatch({ evidence, block }: Context): VerificationCheck {
  const chain = evidence.oracleAtBlock;
  if (!chain) return check("oracle-match", "skip", `could not re-read the oracles at ${block}`);
  const { network, receipt } = evidence;
  const legs = [
    compareLeg(tokenLabel(network, evidence.tokenIn), receipt.oracleIn, chain.tokenIn, block),
    compareLeg(tokenLabel(network, evidence.tokenOut), receipt.oracleOut, chain.tokenOut, block),
  ];
  const status = worstStatus(legs.map(leg => leg.status));
  const notes = legs.filter(leg => leg.status === status).map(leg => leg.note);
  if (status !== "pass") return check("oracle-match", status, notes.join("; "));
  const detail = `the oracles re-read at ${block} give the receipt's readings: ${notes.join("; ")}`;
  return check("oracle-match", "pass", detail);
}

function compareLeg(
  label: string,
  receipt: SerializedOracleReading,
  chain: SerializedOracleReading | null,
  block: string,
): { status: "pass" | "fail" | "skip"; note: string } {
  if (!chain) return { status: "skip", note: `${label}: its oracles could not be re-read at ${block}` };
  const differing = READING_FIELDS.filter(field => String(receipt[field]) !== String(chain[field]));
  if (differing.length === 0) {
    const crossCheck =
      receipt.crossCheckE18 === "0" ? "" : ` (Supra ${usd(receipt.crossCheckE18)}, ${receipt.divergenceBps} bps apart)`;
    return { status: "pass", note: `${label} ${usd(receipt.priceE18)}${crossCheck}` };
  }
  // The Mirror Node re-executes against the state at the END of the block. An oracle update newer than the
  // receipt's can only have landed later in the same block, after the trade read the oracle: a gap in the evidence,
  // not a mismatch.
  if (chain.updatedAt > receipt.updatedAt || chain.crossCheckUpdatedAt > receipt.crossCheckUpdatedAt) {
    return {
      status: "skip",
      note: `${label}: an oracle updated again later in ${block}, so the price the trade saw is not re-readable`,
    };
  }
  const mismatches = differing.map(field => `${field} ${receipt[field]} in the receipt but ${chain[field]} on chain`);
  return { status: "fail", note: `${label}: ${mismatches.join(", ")}` };
}

type OracleRead = { label: string; to: Address; selector: Hex };

function atomicTrace({ evidence, block }: Context): VerificationCheck {
  const { trace, oracleConfigAtBlock: config, vault, network } = evidence;
  if (!trace) return check("atomic-trace", "skip", "the Mirror Node has no call trace for this transaction yet");
  if (!config?.tokenIn || !config.tokenOut) {
    return check("atomic-trace", "skip", `could not read the tokens' oracle configuration at ${block}`);
  }
  const { saucerswap, supra } = getNetwork(network);
  const vaultCalls = trace
    .map((call, index) => ({ ...call, index }))
    .filter(call => call.resultOk && sameAddress(call.caller, vault));
  const swap = vaultCalls.find(
    call => call.selector === TRACE_SELECTORS.saucerswapExactInput && sameAddress(call.to, saucerswap.router),
  );
  if (!swap) {
    const detail = `the vault never called exactInput on the SaucerSwap router ${saucerswap.router}`;
    return check("atomic-trace", "fail", detail);
  }
  const reads = [config.tokenIn, config.tokenOut].flatMap(tokenConfig => requiredReads(tokenConfig, supra));
  const matches = (read: OracleRead) => (call: { to: Address; selector: Hex }) =>
    call.selector === read.selector && sameAddress(call.to, read.to);
  // Each configured read must be its own call: a token pair priced by Supra twice needs two getSvalue calls.
  const unused = vaultCalls.filter(call => call.index < swap.index);
  const used: number[] = [];
  const missing: string[] = [];
  for (const read of reads) {
    const position = unused.findIndex(matches(read));
    const [call] = position === -1 ? [] : unused.splice(position, 1);
    if (call) {
      used.push(call.index);
    } else {
      const readLate = vaultCalls.some(late => late.index > swap.index && matches(read)(late));
      missing.push(readLate ? `${read.label} (only after the swap)` : read.label);
    }
  }
  if (missing.length > 0) {
    return check("atomic-trace", "fail", `the vault swapped without first reading ${missing.join(", ")}`);
  }
  const callIndexes = { oracleCalls: used.join(","), swapCall: String(swap.index) };
  const labels = reads.map(read => read.label).join(", ");
  const detail = `in one transaction the vault read ${labels}, then swapped on SaucerSwap (call ${swap.index})`;
  return check("atomic-trace", "pass", detail, callIndexes);
}

function requiredReads(config: TokenOracleConfig, supra: Address): OracleRead[] {
  const reads: OracleRead[] = [];
  if (config.chainlinkFeed) {
    reads.push({
      label: `Chainlink ${short(config.chainlinkFeed)}`,
      to: config.chainlinkFeed,
      selector: TRACE_SELECTORS.chainlinkLatestRoundData,
    });
  }
  if (config.supraPairId !== null) {
    reads.push({ label: `Supra pair ${config.supraPairId}`, to: supra, selector: TRACE_SELECTORS.supraGetSvalue });
  }
  return reads;
}

function executionQuality({ evidence, block }: Context): VerificationCheck {
  const maxSlippageBps = evidence.policyMaxSlippageBps;
  if (maxSlippageBps === null) {
    return check("execution-quality", "skip", `could not read the vault's policy at ${block}`);
  }
  const { network, tokenOut, receipt } = evidence;
  // The vault sets minAmountOut = oracleFair * (10_000 - maxSlippageBps) / 10_000, so the oracle-fair output follows.
  const fair = (BigInt(receipt.minAmountOut) * 10_000n) / BigInt(10_000 - maxSlippageBps);
  if (fair === 0n) return check("execution-quality", "warn", "the oracle-fair output rounds to zero");
  const amountOut = BigInt(receipt.amountOut);
  const deltaBps = ((amountOut - fair) * 10_000n) / fair;
  const numbers = {
    amountOut: amountOut.toString(),
    oracleFairOut: fair.toString(),
    deltaBps: deltaBps.toString(),
    maxSlippageBps: String(maxSlippageBps),
  };
  const received = `received ${formatAmount(network, tokenOut, amountOut)}`;
  const reference = `the oracle-fair ${formatAmount(network, tokenOut, fair)}`;
  if (deltaBps >= 0n) {
    return check("execution-quality", "pass", `${received}, ${deltaBps} bps above ${reference}`, numbers);
  }
  const shortfall = -deltaBps;
  const within = shortfall <= BigInt(maxSlippageBps);
  const policy = `${within ? "within" : "beyond"} the ${maxSlippageBps} bps policy`;
  const detail = `${received}, ${shortfall} bps below ${reference}, ${policy}`;
  // The vault refuses any output below its minimum, so a shortfall beyond the policy means the receipt is not one a
  // genuine vault running this policy could have emitted.
  return check("execution-quality", within ? "pass" : "fail", detail, numbers);
}

/** Case-insensitive, so checksummed and lowercase forms of one address compare equal. */
function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Mirror Node keys are equal when their type and hex match, ignoring case and a 0x prefix. */
export function sameHederaKey(a: HederaKey, b: HederaKey): boolean {
  const hex = (key: string) => key.toLowerCase().replace(/^0x/, "");
  return a.type === b.type && hex(a.key) === hex(b.key);
}

/** The Mirror Node reports senders by long-zero address while the vault stores the account's EVM alias; accept both. */
function isAccount(address: Address, account: { accountId: string; evmAddress: Address | null }): boolean {
  return (
    (account.evmAddress !== null && sameAddress(address, account.evmAddress)) ||
    entityIdFromLongZero(address) === account.accountId
  );
}

/** Exact gap between two consensus timestamps, in seconds with up to nanosecond precision. */
function gap(from: string, to: string): string {
  const nanos = (timestamp: string) => {
    const [seconds = "0", fraction = ""] = timestamp.split(".");
    return BigInt(seconds) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0").slice(0, 9));
  };
  const difference = nanos(to) - nanos(from);
  const fraction = (difference % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${difference / 1_000_000_000n}${fraction ? `.${fraction}` : ""} s`;
}

function knownToken(network: NetworkName, token: Address): TokenRef | undefined {
  const { baseToken, quoteToken } = getNetwork(network);
  return [baseToken, quoteToken].find(ref => sameAddress(ref.address, token));
}

function tokenLabel(network: NetworkName, token: Address): string {
  return knownToken(network, token)?.symbol ?? short(token);
}

function formatAmount(network: NetworkName, token: Address, amount: bigint | string): string {
  const known = knownToken(network, token);
  return known
    ? `${formatUnits(BigInt(amount), known.decimals)} ${known.symbol}`
    : `${amount} units of ${short(token)}`;
}

function usd(valueE18: string): string {
  return `$${formatUnits(BigInt(valueE18), 18)}`;
}

function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
