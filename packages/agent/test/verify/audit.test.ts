import { type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeDecision, type DecisionRecord } from "../../src/decision";
import { auditDecisionLog } from "../../src/verify";
import { auditLog } from "../../src/verify/audit";
import { decisionEntry } from "../../src/verify/decisions";
import { type TradeEvent } from "../../src/verify/trades";
import { FakeMirror } from "./fake-mirror";
import {
  AGENT_ADDRESS,
  AGENT_ID,
  AGENT_KEY,
  agentAccount,
  hcsMessage,
  holdRecord,
  MIRROR_URL,
  rejectedRecord,
  stubChainState,
  TOPIC_ID,
  tradeRecord,
  VAULT,
  vaultPolicyLog,
  vaultTradeLog,
} from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Message = { sequence: number; record: DecisionRecord | string; payer?: string };

const hashOf = (record: DecisionRecord): Hex => encodeDecision(record).hash;

/** A trade the vault executed 3 s after the message it references. */
function tradeFor(tradeId: number, sequence: number, reasoningHash: Hex) {
  return vaultTradeLog({ tradeId, sequence, reasoningHash, at: `${1_790_000_003 + sequence * 10}.000000000` });
}

function serveLog(messages: Message[], logs: unknown[]): void {
  const newestFirst = [...messages].sort((a, b) => b.sequence - a.sequence);
  const mirror = new FakeMirror()
    .route(`/api/v1/topics/${TOPIC_ID}`, {
      topic_id: TOPIC_ID,
      created_timestamp: "1789990000.000000000",
      deleted: false,
      submit_key: AGENT_KEY,
    })
    .route(`/api/v1/topics/${TOPIC_ID}/messages`, {
      messages: newestFirst.map(message => hcsMessage(message.sequence, message.record, { payer: message.payer })),
      links: { next: null },
    })
    .route(`/api/v1/contracts/${VAULT}/results/logs`, { logs, links: { next: null } })
    .route(`/api/v1/accounts/${AGENT_ADDRESS}`, agentAccount());
  stubChainState(mirror, "latest");
  vi.stubGlobal("fetch", mirror.fetch);
}

function audit() {
  return auditDecisionLog({ network: "testnet", vault: VAULT, topicId: TOPIC_ID, mirrorUrl: MIRROR_URL });
}

const trade41 = tradeRecord({ rationale: "decision 41" });
const trade43 = tradeRecord({ rationale: "decision 43" });

describe("auditDecisionLog", () => {
  it("passes a log where every trade is backed and every trade decision has an outcome", async () => {
    serveLog(
      [
        { sequence: 40, record: holdRecord() },
        { sequence: 41, record: trade41 },
        { sequence: 42, record: rejectedRecord({ stage: "simulation", error: "CooldownActive", detail: "" }) },
        { sequence: 43, record: trade43 },
        {
          sequence: 44,
          record: rejectedRecord({ stage: "execution", error: "InsufficientOutput", detail: "", decisionSeq: 43 }),
        },
        { sequence: 45, record: holdRecord() },
      ],
      [tradeFor(6, 41, hashOf(trade41)), vaultPolicyLog("1789995000.000000000")],
    );

    const report = await audit();

    expect(report).toMatchObject({
      fromSequence: 40,
      toSequence: 45,
      decisions: { trade: 2, hold: 2, rejected: 2, invalid: 0, foreignPayer: 0 },
      trades: 1,
      matchedTrades: 1,
      unmatchedTrades: [],
      tradeRecordsWithoutOutcome: [],
      findings: [],
      ok: true,
    });
  });

  it("finds an unbacked trade, a trade decision without outcome, invalid messages and foreign payers", async () => {
    const trade44 = tradeRecord({ rationale: "decision 44" });
    const hold45 = holdRecord("holding after 44");
    serveLog(
      [
        { sequence: 41, record: trade41 },
        { sequence: 42, record: "not json {" },
        { sequence: 43, record: holdRecord(), payer: "0.0.9999" },
        { sequence: 44, record: trade44 },
        { sequence: 45, record: hold45 },
      ],
      [tradeFor(7, 45, hashOf(hold45)), tradeFor(6, 41, hashOf(trade41))],
    );

    const report = await audit();

    expect(report.decisions).toEqual({ trade: 2, hold: 2, rejected: 0, invalid: 1, foreignPayer: 1 });
    expect(report.trades).toBe(2);
    expect(report.matchedTrades).toBe(1);
    expect(report.unmatchedTrades).toEqual([expect.objectContaining({ tradeId: 7, hcsSequence: 45 })]);
    expect(report.tradeRecordsWithoutOutcome).toEqual([44]);
    expect(report.findings).toEqual([
      { severity: "warning", message: "message 42 is not a valid decision record: message is not valid JSON" },
      { severity: "warning", message: `message 43 was paid for by 0.0.9999, not by the agent ${AGENT_ID}` },
      {
        severity: "error",
        message: `trade #7 (0x${"7".padStart(64, "0")}) references message 45, which is a "hold" record`,
      },
      {
        severity: "error",
        message: "trade decision 44 was never executed and no execution-stage rejection explains why",
      },
    ]);
    expect(report.ok).toBe(false);
  });

  it("refuses an address that is not an AgentVault", async () => {
    serveLog([], []);
    await expect(
      auditDecisionLog({ network: "testnet", vault: AGENT_ADDRESS, topicId: TOPIC_ID, mirrorUrl: MIRROR_URL }),
    ).rejects.toMatchObject({ code: "invalid-input", message: expect.stringContaining("is it an AgentVault") });
  });
});

describe("auditLog rules", () => {
  const entries = (messages: Message[]) =>
    messages
      .map(message => decisionEntry(hcsMessage(message.sequence, message.record, { payer: message.payer })))
      .reverse();

  function tradeEvent(tradeId: number, sequence: number, reasoningHash: Hex, consensusTimestamp: string): TradeEvent {
    return {
      txHash: `0x${tradeId.toString(16).padStart(64, "0")}`,
      consensusTimestamp,
      tradeId,
      tokenIn: VAULT,
      tokenOut: VAULT,
      amountIn: "1",
      amountOut: "1",
      minAmountOut: "1",
      usdValue: "1",
      hcsSequence: sequence,
      reasoningHash,
      hcsTopicNum: "6300001",
    };
  }

  const base = {
    network: "testnet" as const,
    vault: VAULT,
    topicId: TOPIC_ID,
    submitKey: { type: AGENT_KEY._type, key: AGENT_KEY.key },
    agent: { accountId: AGENT_ID, key: { type: AGENT_KEY._type, key: AGENT_KEY.key } },
  };

  it("rejects a trade executed before its decision was published, or with another hash", () => {
    const decisions = entries([{ sequence: 41, record: trade41 }]);
    const early = auditLog({
      ...base,
      decisions,
      trades: [tradeEvent(6, 41, hashOf(trade41), "1790000400.000000000")],
    });
    expect(early.findings).toContainEqual({
      severity: "error",
      message: expect.stringContaining("executed before message 41 was published"),
    });

    const forged = auditLog({
      ...base,
      decisions,
      trades: [tradeEvent(6, 41, hashOf(trade43), "1790000500.000000000")],
    });
    expect(forged.findings).toContainEqual({
      severity: "error",
      message: expect.stringContaining("but message 41 hashes to"),
    });
    expect(forged.unmatchedTrades).toHaveLength(1);
  });

  it("only warns about the newest trade decision, whose outcome may still be in flight", () => {
    const report = auditLog({ ...base, decisions: entries([{ sequence: 41, record: trade41 }]), trades: [] });
    expect(report.findings).toEqual([
      { severity: "warning", message: "trade decision 41 has no trade or rejection yet" },
    ]);
    expect(report.tradeRecordsWithoutOutcome).toEqual([41]);
    expect(report.ok).toBe(true);
  });

  it("flags a topic anyone can write to, or one keyed to someone else", () => {
    const open = auditLog({ ...base, submitKey: null, decisions: [], trades: [] });
    expect(open.findings).toEqual([
      { severity: "error", message: `topic ${TOPIC_ID} has no submit key, so anyone can publish decisions to it` },
    ]);
    const foreign = auditLog({
      ...base,
      submitKey: { type: "ECDSA_SECP256K1", key: "03ff" },
      decisions: [],
      trades: [],
    });
    expect(foreign.ok).toBe(false);
  });

  it("is not ok when the agent's account or key cannot be resolved", () => {
    const unresolved = auditLog({ ...base, agent: null, decisions: [], trades: [] });
    expect(unresolved.findings).toEqual([
      {
        severity: "error",
        message:
          "could not resolve the vault's agent to a Hedera account, so the submit key and payers were not checked",
      },
    ]);
    expect(unresolved.ok).toBe(false);

    const keyless = auditLog({ ...base, agent: { accountId: AGENT_ID, key: null }, decisions: [], trades: [] });
    expect(keyless.findings).toEqual([
      {
        severity: "error",
        message: `the vault's agent ${AGENT_ID} has no key, so the topic's submit key cannot be tied to it`,
      },
    ]);
    expect(keyless.ok).toBe(false);
  });

  it("warns when the Mirror Node serves a window with missing sequence numbers", () => {
    const decisions = entries([
      { sequence: 7, record: holdRecord() },
      { sequence: 9, record: holdRecord() },
    ]);
    const report = auditLog({ ...base, decisions, trades: [] });
    expect(report).toMatchObject({ fromSequence: 7, toSequence: 9, decisions: { hold: 2 }, ok: true });
    expect(report.findings).toEqual([
      { severity: "warning", message: "the Mirror Node returned 2 messages for sequences 7 to 9" },
    ]);
  });
});
