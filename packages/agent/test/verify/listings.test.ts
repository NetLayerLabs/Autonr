import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeDecision } from "../../src/decision";
import { listDecisions, listTrades } from "../../src/verify";
import { FakeMirror } from "./fake-mirror";
import {
  hcsMessage,
  holdRecord,
  messageTimestamp,
  MIRROR_URL,
  TOPIC_ID,
  tradeRecord,
  VAULT,
  vaultPolicyLog,
  vaultTradeLog,
} from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

function serve(mirror: FakeMirror): FakeMirror {
  vi.stubGlobal("fetch", mirror.fetch);
  return mirror;
}

describe("listDecisions", () => {
  it("decodes valid records and flags invalid ones instead of dropping them", async () => {
    const trade = tradeRecord();
    const messages = [
      hcsMessage(45, holdRecord()),
      hcsMessage(44, "not json {"),
      hcsMessage(43, JSON.stringify({ schema: "someone-else/v2", kind: "trade" })),
      hcsMessage(42, trade),
    ];
    serve(new FakeMirror().route(`/api/v1/topics/${TOPIC_ID}/messages`, { messages, links: { next: null } }));

    const entries = await listDecisions({ network: "testnet", topicId: TOPIC_ID, mirrorUrl: MIRROR_URL });

    expect(entries.map(entry => entry.sequence)).toEqual([45, 44, 43, 42]);
    expect(entries[0]).toMatchObject({ record: { kind: "hold" }, error: null });
    expect(entries[1]).toMatchObject({ record: null, error: "message is not valid JSON", raw: "not json {" });
    expect(entries[2]?.record).toBeNull();
    expect(entries[2]?.error).toContain("schema");
    expect(entries[3]).toEqual({
      sequence: 42,
      consensusTimestamp: messageTimestamp(42),
      payer: "0.0.6200001",
      hash: encodeDecision(trade).hash,
      record: trade,
      error: null,
      raw: encodeDecision(trade).json,
    });
  });

  it("follows the Mirror Node's next links until it has enough messages", async () => {
    const next = `/api/v1/topics/${TOPIC_ID}/messages?order=desc&limit=3&timestamp=lt:${messageTimestamp(44)}`;
    const mirror = serve(
      new FakeMirror()
        .route(`/api/v1/topics/${TOPIC_ID}/messages?order=desc&limit=3`, {
          messages: [hcsMessage(45, holdRecord()), hcsMessage(44, holdRecord())],
          links: { next },
        })
        .route(next, { messages: [hcsMessage(43, holdRecord()), hcsMessage(42, holdRecord())], links: { next: null } }),
    );

    const entries = await listDecisions({ network: "testnet", topicId: TOPIC_ID, limit: 3, mirrorUrl: MIRROR_URL });

    expect(entries.map(entry => entry.sequence)).toEqual([45, 44, 43]);
    expect(mirror.requests).toHaveLength(2);
  });

  it("rejects a malformed topic id or limit", async () => {
    await expect(listDecisions({ network: "testnet", topicId: "topic-1" })).rejects.toMatchObject({
      code: "invalid-input",
    });
    await expect(listDecisions({ network: "testnet", topicId: TOPIC_ID, limit: 0 })).rejects.toMatchObject({
      code: "invalid-input",
    });
  });
});

describe("listTrades", () => {
  const trade = (tradeId: number) =>
    vaultTradeLog({
      tradeId,
      sequence: 40 + tradeId,
      reasoningHash: `0x${"aa".repeat(32)}`,
      at: `${1_790_000_000 + tradeId}.0`,
    });

  it("returns the newest TradeExecuted events and skips the vault's other events", async () => {
    const logs = [trade(8), vaultPolicyLog("1790000007.5"), trade(7), trade(6)];
    serve(new FakeMirror().route(`/api/v1/contracts/${VAULT}/results/logs`, { logs, links: { next: null } }));

    const trades = await listTrades({ network: "testnet", vault: VAULT, limit: 2, mirrorUrl: MIRROR_URL });

    expect(trades).toEqual([
      expect.objectContaining({
        tradeId: 8,
        hcsSequence: 48,
        amountIn: "1000000000",
        consensusTimestamp: "1790000008.0",
      }),
      expect.objectContaining({ tradeId: 7, hcsSequence: 47 }),
    ]);
    expect(Object.keys(trades[0] ?? {})).not.toContain("reasoningHash");
  });

  it("stops scanning a contract that emits thousands of other events", async () => {
    const logs = Array.from({ length: 2001 }, () => vaultPolicyLog("1790000000.0"));
    serve(new FakeMirror().route(`/api/v1/contracts/${VAULT}/results/logs`, { logs, links: { next: null } }));

    await expect(listTrades({ network: "testnet", vault: VAULT, mirrorUrl: MIRROR_URL })).rejects.toMatchObject({
      code: "invalid-input",
      message: expect.stringContaining("is it an AgentVault?"),
    });
  });
});
