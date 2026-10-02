import { type Address } from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { compareConsensusTimestamps, entityNum } from "../hedera";
import { type MirrorClient, orNull } from "../mirror";
import { type NetworkName } from "../networks";
import { decisionEntry } from "./decisions";
import { VerifyError } from "./errors";
import { sameHederaKey } from "./evaluate";
import { addressInput, limitInput, mirrorFor, topicIdInput } from "./input";
import { readView } from "./onchain";
import { type TradeEvent, tradeEvents, toSummary } from "./trades";
import { type AuditFinding, type AuditReport, type DecisionEntry, type HederaKey } from "./types";

const DEFAULT_AUDIT_LIMIT = 100;

type AgentAccount = { accountId: string; key: HederaKey | null };

/**
 * Audits the last `limit` decisions against everything the vault executed for them: every trade must be backed by an
 * earlier "trade" record with the same sequence and hash, every "trade" record must end in a trade or an
 * execution-stage rejection, and every message must come from the agent. Invalid messages are reported, never hidden.
 */
export async function auditDecisionLog(input: {
  network: NetworkName;
  vault: Address;
  topicId: string;
  limit?: number;
  mirrorUrl?: string;
}): Promise<AuditReport> {
  const vault = addressInput(input.vault, "vault");
  const topicId = topicIdInput(input.topicId);
  const limit = limitInput(input.limit, DEFAULT_AUDIT_LIMIT);
  const mirror = mirrorFor(input.network, input.mirrorUrl);
  const topic = await orNull(mirror.topic(topicId));
  if (!topic) throw new VerifyError("not-found", `topic ${topicId} does not exist on ${input.network}`);

  const agentAddress = await readView(mirror, "latest", { address: vault, abi: agentVaultAbi, functionName: "agent" });
  if (!agentAddress) {
    const reason = `${vault} does not answer agent(); is it an AgentVault on ${input.network}?`;
    throw new VerifyError("invalid-input", reason);
  }
  const [messages, agent] = await Promise.all([
    mirror.topicMessages(topicId, limit),
    agentAccount(mirror, agentAddress),
  ]);
  const decisions = messages.map(decisionEntry);
  const fromSequence = decisions.length > 0 ? Math.min(...decisions.map(entry => entry.sequence)) : 1;
  const trades = await tradesSince(mirror, vault, topicId, fromSequence, topic.created_timestamp);
  const submitKey = topic.submit_key && { type: topic.submit_key._type, key: topic.submit_key.key };
  return auditLog({ network: input.network, vault, topicId, submitKey, agent, decisions, trades });
}

async function agentAccount(mirror: MirrorClient, agent: Address): Promise<AgentAccount | null> {
  const account = await orNull(mirror.account(agent));
  return (
    account && { accountId: account.account, key: account.key && { type: account.key._type, key: account.key.key } }
  );
}

/**
 * The vault's trades on this topic from `fromSequence` on, newest first. A trade cannot reference a topic that did not
 * exist yet, so the scan starts at the topic's creation; and since the vault only accepts strictly increasing
 * reasoning sequences, the first older trade on this topic ends it.
 */
async function tradesSince(
  mirror: MirrorClient,
  vault: Address,
  topicId: string,
  fromSequence: number,
  topicCreatedAt: string | null,
): Promise<TradeEvent[]> {
  const topicNum = entityNum(topicId).toString();
  const trades: TradeEvent[] = [];
  for await (const trade of tradeEvents(mirror, vault, topicCreatedAt ?? undefined)) {
    if (trade.hcsTopicNum !== topicNum) continue;
    if (trade.hcsSequence < fromSequence) break;
    trades.push(trade);
  }
  return trades;
}

/** The audit rules, without I/O. `decisions` and `trades` are newest first; `trades` all reference this topic. */
export function auditLog(input: {
  network: NetworkName;
  vault: Address;
  topicId: string;
  submitKey: HederaKey | null;
  agent: AgentAccount | null;
  decisions: DecisionEntry[];
  trades: TradeEvent[];
}): AuditReport {
  const { topicId, agent, decisions, trades } = input;
  const findings: AuditFinding[] = [];
  const error = (message: string) => findings.push({ severity: "error", message });
  const warning = (message: string) => findings.push({ severity: "warning", message });

  // Without the agent's account and key, neither the submit key nor the payers can be tied to the agent: an audit
  // that skipped those checks must not report the log as clean.
  if (!input.submitKey) {
    error(`topic ${topicId} has no submit key, so anyone can publish decisions to it`);
  } else if (agent?.key && !sameHederaKey(agent.key, input.submitKey)) {
    error(`topic ${topicId}'s submit key is not the key of the vault's agent ${agent.accountId}`);
  }
  if (!agent) {
    error("could not resolve the vault's agent to a Hedera account, so the submit key and payers were not checked");
  } else if (!agent.key) {
    error(`the vault's agent ${agent.accountId} has no key, so the topic's submit key cannot be tied to it`);
  }

  const sequences = decisions.map(entry => entry.sequence);
  const fromSequence = sequences.length > 0 ? Math.min(...sequences) : 0;
  const toSequence = sequences.length > 0 ? Math.max(...sequences) : 0;
  if (
    decisions.length !== new Set(sequences).size ||
    (decisions.length > 0 && toSequence - fromSequence + 1 !== decisions.length)
  ) {
    warning(`the Mirror Node returned ${decisions.length} messages for sequences ${fromSequence} to ${toSequence}`);
  }

  const counts = { trade: 0, hold: 0, rejected: 0, invalid: 0, foreignPayer: 0 };
  for (const entry of [...decisions].reverse()) {
    if (entry.record) {
      counts[entry.record.kind] += 1;
    } else {
      counts.invalid += 1;
      warning(`message ${entry.sequence} is not a valid decision record: ${entry.error?.replace(/\s*\n\s*/g, "; ")}`);
    }
    if (agent && entry.payer !== agent.accountId) {
      counts.foreignPayer += 1;
      warning(`message ${entry.sequence} was paid for by ${entry.payer}, not by the agent ${agent.accountId}`);
    }
  }

  const bySequence = new Map(decisions.map(entry => [entry.sequence, entry]));
  const backing = new Map<number, TradeEvent>();
  const unmatched: TradeEvent[] = [];
  for (const trade of [...trades].reverse()) {
    const problem = unbackedReason(trade, bySequence.get(trade.hcsSequence), backing.get(trade.hcsSequence), topicId);
    if (problem) {
      unmatched.unshift(trade);
      error(`trade #${trade.tradeId} (${trade.txHash}) ${problem}`);
    } else {
      backing.set(trade.hcsSequence, trade);
    }
  }

  const tradeRecordsWithoutOutcome: number[] = [];
  for (const entry of [...decisions].reverse()) {
    const hasOutcome = backing.has(entry.sequence) || rejectedLater(entry.sequence, decisions);
    if (entry.record?.kind !== "trade" || hasOutcome) continue;
    tradeRecordsWithoutOutcome.push(entry.sequence);
    // The newest record may still be in flight; one the agent has published past has silently lost its outcome.
    if (entry.sequence === toSequence) {
      warning(`trade decision ${entry.sequence} has no trade or rejection yet`);
    } else {
      error(`trade decision ${entry.sequence} was never executed and no execution-stage rejection explains why`);
    }
  }

  return {
    network: input.network,
    vault: input.vault,
    topicId,
    fromSequence,
    toSequence,
    decisions: counts,
    trades: trades.length,
    matchedTrades: backing.size,
    unmatchedTrades: unmatched.map(toSummary),
    tradeRecordsWithoutOutcome,
    findings,
    ok: findings.every(finding => finding.severity !== "error"),
  };
}

/** Why `trade` is not backed by the decision at its sequence, or null when it is. */
function unbackedReason(
  trade: TradeEvent,
  entry: DecisionEntry | undefined,
  alreadyBacking: TradeEvent | undefined,
  topicId: string,
): string | null {
  const sequence = trade.hcsSequence;
  if (!entry) return `references message ${sequence}, which is not among the audited messages of topic ${topicId}`;
  if (entry.record?.kind !== "trade") {
    const what = entry.record ? `a "${entry.record.kind}" record` : "not a valid decision record";
    return `references message ${sequence}, which is ${what}`;
  }
  if (entry.hash.toLowerCase() !== trade.reasoningHash.toLowerCase()) {
    return `commits to hash ${trade.reasoningHash}, but message ${sequence} hashes to ${entry.hash}`;
  }
  if (compareConsensusTimestamps(entry.consensusTimestamp, trade.consensusTimestamp) >= 0) {
    return `executed before message ${sequence} was published`;
  }
  if (alreadyBacking) return `reuses message ${sequence}, which already backs trade #${alreadyBacking.tradeId}`;
  return null;
}

function rejectedLater(sequence: number, decisions: DecisionEntry[]): boolean {
  return decisions.some(
    entry =>
      entry.sequence > sequence &&
      entry.record?.rejection?.stage === "execution" &&
      entry.record.rejection.decisionSeq === sequence,
  );
}
