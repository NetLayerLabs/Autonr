import { afterEach, describe, expect, it, vi } from "vitest";
import { agentVaultAbi } from "../../src/abi/agentVault";
import { longZeroAddress } from "../../src/hedera";
import { chainlinkAggregatorAbi } from "../../src/oracles/chainlink";
import {
  type CheckId,
  type CheckStatus,
  evaluateTradeEvidence,
  fetchTradeEvidence,
  type HederaKey,
  type TradeEvidence,
  type VerificationCheck,
  VerifyError,
  verifyTrade,
} from "../../src/verify";
import { type FakeMirror } from "./fake-mirror";
import {
  action,
  AGENT_ADDRESS,
  AGENT_ID,
  BLOCK,
  deployedVaultCode,
  FEED,
  holdRecord,
  MESSAGE_AT,
  MIRROR_URL,
  ROUTER,
  stubView,
  SUPRA,
  TOPIC_ID,
  TRADE_AT,
  tradeActions,
  tradeRecord,
  tradeScenario,
  TRANSACTION_ID,
  TX_HASH,
  USDC,
  VAULT,
  vaultContract,
  VAULT_ID,
  WHBAR,
} from "./fixtures";

const CHECK_IDS: CheckId[] = [
  "tx-success",
  "vault-code",
  "topic-pinned",
  "message-found",
  "hash-match",
  "ordering",
  "same-key",
  "schema-valid",
  "content-match",
  "oracle-match",
  "atomic-trace",
  "execution-quality",
];

afterEach(() => {
  vi.unstubAllGlobals();
});

function serve(mirror: FakeMirror): void {
  vi.stubGlobal("fetch", mirror.fetch);
}

async function evidenceFrom(mirror: FakeMirror): Promise<TradeEvidence> {
  serve(mirror);
  return fetchTradeEvidence({ network: "testnet", tx: TX_HASH, mirrorUrl: MIRROR_URL });
}

function statuses(checks: VerificationCheck[]): Record<CheckId, CheckStatus> {
  return Object.fromEntries(checks.map(check => [check.id, check.status])) as Record<CheckId, CheckStatus>;
}

function byId(checks: VerificationCheck[], id: CheckId): VerificationCheck {
  const found = checks.find(check => check.id === id);
  if (!found) throw new Error(`no ${id} check`);
  return found;
}

/** Evaluates a tampered copy, the way the dashboard's tamper lab does. */
function tampered(evidence: TradeEvidence, tamper: (copy: TradeEvidence) => void) {
  const copy = structuredClone(evidence);
  tamper(copy);
  return evaluateTradeEvidence(copy);
}

function allPassExcept(overrides: Partial<Record<CheckId, CheckStatus>>): Record<CheckId, CheckStatus> {
  return { ...Object.fromEntries(CHECK_IDS.map(id => [id, "pass"])), ...overrides } as Record<CheckId, CheckStatus>;
}

describe("verifyTrade on an honest trade", () => {
  it("passes all 12 checks and links the evidence on HashScan", async () => {
    const { mirror, record } = tradeScenario();
    serve(mirror);

    const proof = await verifyTrade({ network: "testnet", tx: TX_HASH, mirrorUrl: MIRROR_URL });

    expect(proof.checks.map(check => check.id)).toEqual(CHECK_IDS);
    expect(statuses(proof.checks)).toEqual(allPassExcept({}));
    expect(proof.verdict).toBe("verified");
    expect(proof).toMatchObject({
      txHash: TX_HASH,
      transactionId: TRANSACTION_ID,
      blockNumber: BLOCK,
      vault: VAULT,
      tradeId: 7,
      tokenIn: WHBAR,
      tokenOut: USDC,
      topicId: TOPIC_ID,
      sequence: 42,
      decision: record,
      links: {
        tx: `https://hashscan.io/testnet/transaction/${TX_HASH}`,
        topicMessage: `https://hashscan.io/testnet/transaction/${MESSAGE_AT}/message`,
        vault: `https://hashscan.io/testnet/contract/${VAULT}`,
      },
    });
    expect(byId(proof.checks, "ordering").detail).toBe("published 3.400000001 s before the trade reached consensus");
    expect(byId(proof.checks, "execution-quality").evidence).toMatchObject({
      oracleFairOut: "1024529",
      maxSlippageBps: "300",
    });
  });

  it("accepts a Hedera transaction id in either notation", async () => {
    const { mirror } = tradeScenario();
    mirror.route(`/api/v1/contracts/results/${TRANSACTION_ID}`, await contractResultBody(mirror));
    serve(mirror);

    const proof = await verifyTrade({
      network: "testnet",
      tx: "0.0.7314364@1790000001.123456789",
      mirrorUrl: MIRROR_URL,
    });

    expect(proof.verdict).toBe("verified");
    expect(proof.transactionId).toBe(TRANSACTION_ID);
    expect(mirror.requests).toContain(`GET /api/v1/contracts/results/${TRANSACTION_ID}`);
  });

  it("gathers the trace, sender and oracle state in the vault's own terms", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);

    expect(evidence.from).toBe(longZeroAddress(AGENT_ID));
    expect(evidence.agentAccount).toEqual({
      accountId: AGENT_ID,
      evmAddress: AGENT_ADDRESS,
      key: { type: "ECDSA_SECP256K1", key: expect.stringMatching(/^02/) },
    });
    expect(evidence.oracleAtBlock).toEqual({
      tokenIn: evidence.receipt.oracleIn,
      tokenOut: evidence.receipt.oracleOut,
    });
    expect(evidence.oracleConfigAtBlock).toEqual({
      tokenIn: { chainlinkFeed: FEED, supraPairId: 75 },
      tokenOut: { chainlinkFeed: null, supraPairId: 89 },
    });
    expect(evidence.poolFee).toBe(3000);
    expect(evidence.policyMaxSlippageBps).toBe(300);
    // Mirror Node actions name contracts by long-zero address; known ones are mapped back to their EVM addresses.
    expect(evidence.trace?.[1]).toEqual({ depth: 1, caller: VAULT, to: FEED, selector: "0xfeaf968c", resultOk: true });
    expect(evidence.trace?.[4]).toMatchObject({ caller: VAULT, to: SUPRA, selector: "0x89b94ea2" });
    expect(evidence.trace?.[10]).toMatchObject({ caller: VAULT, to: ROUTER, selector: "0xc04b8d59" });
  });

  it("evaluates the same after a JSON round trip, as evidence travels to the browser", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    expect(evaluateTradeEvidence(JSON.parse(JSON.stringify(evidence)))).toEqual(evaluateTradeEvidence(evidence));
  });
});

describe("verifyTrade input and lookup errors", () => {
  it("rejects something that is not a transaction reference", async () => {
    await expect(verifyTrade({ network: "testnet", tx: "0x1234", mirrorUrl: MIRROR_URL })).rejects.toMatchObject({
      code: "invalid-input",
    });
  });

  it("reports a transaction the Mirror Node does not have", async () => {
    const { mirror } = tradeScenario();
    mirror.unroute(`/api/v1/contracts/results/${TX_HASH}`);
    serve(mirror);
    const result = verifyTrade({ network: "testnet", tx: TX_HASH, mirrorUrl: MIRROR_URL });
    await expect(result).rejects.toBeInstanceOf(VerifyError);
    await expect(result).rejects.toMatchObject({ code: "not-found" });
  });

  it("skips a log that only borrows TradeExecuted's signature, instead of crashing on it", async () => {
    const { mirror } = tradeScenario();
    const body = await contractResultBody(mirror);
    const logs = body.logs as { topics: string[] }[];
    const malformed = { ...logs[1], topics: logs[1]?.topics.slice(0, 1), data: "0x1234" };
    mirror.route(`/api/v1/contracts/results/${TX_HASH}`, { ...body, logs: [malformed] });
    serve(mirror);
    await expect(verifyTrade({ network: "testnet", tx: TX_HASH, mirrorUrl: MIRROR_URL })).rejects.toMatchObject({
      code: "not-a-trade",
    });

    mirror.route(`/api/v1/contracts/results/${TX_HASH}`, { ...body, logs: [malformed, ...logs] });
    expect((await verifyTrade({ network: "testnet", tx: TX_HASH, mirrorUrl: MIRROR_URL })).verdict).toBe("verified");
  });

  it("refuses a transaction that emitted no TradeExecuted event", async () => {
    const { mirror } = tradeScenario();
    mirror.route(`/api/v1/contracts/results/${TX_HASH}`, { ...(await contractResultBody(mirror)), logs: [] });
    serve(mirror);
    await expect(verifyTrade({ network: "testnet", tx: TX_HASH, mirrorUrl: MIRROR_URL })).rejects.toMatchObject({
      code: "not-a-trade",
    });
  });
});

describe("tampering is caught", () => {
  it("fails hash-match when one byte of the message changes", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    const result = tampered(evidence, copy => {
      const text = Buffer.from(copy.message?.raw ?? "", "base64").toString("utf8");
      // A rationale byte: the JSON stays a valid trade record, only the committed hash no longer matches.
      copy.message = copy.message && {
        ...copy.message,
        raw: Buffer.from(text.replace("62%", "63%")).toString("base64"),
      };
    });
    expect(statuses(result.checks)).toEqual(allPassExcept({ "hash-match": "fail" }));
    expect(result.verdict).toBe("failed");
  });

  it("fails ordering for a message published a single nanosecond after the trade", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    const late = tampered(evidence, copy => {
      copy.message = copy.message && { ...copy.message, consensusTimestamp: "1790000003.500000002" };
    });
    expect(byId(late.checks, "ordering")).toMatchObject({
      status: "fail",
      detail: "the message was published 0.000000001 s after the trade",
    });
    const tied = tampered(evidence, copy => {
      copy.message = copy.message && { ...copy.message, consensusTimestamp: TRADE_AT };
    });
    expect(byId(tied.checks, "ordering").status).toBe("fail");
    const justInTime = tampered(evidence, copy => {
      copy.message = copy.message && { ...copy.message, consensusTimestamp: "1790000003.5" };
    });
    expect(byId(justInTime.checks, "ordering")).toMatchObject({
      status: "pass",
      detail: "published 0.000000001 s before the trade reached consensus",
    });
  });

  it("fails same-key when the topic's submit key is not the agent's key", async () => {
    const { mirror } = tradeScenario({
      submitKey: {
        _type: "ECDSA_SECP256K1",
        key: "03f4476d20fc1835ec52e5ef0621fe6b07482c146887cad18477bb91b9f58338aa",
      },
    });
    const result = evaluateTradeEvidence(await evidenceFrom(mirror));
    expect(statuses(result.checks)).toEqual(allPassExcept({ "same-key": "fail" }));
    expect(byId(result.checks, "same-key").detail).toContain(`is not held by the vault's agent ${AGENT_ID}`);
  });

  it("fails same-key when another account paid for the message", async () => {
    const result = evaluateTradeEvidence(await evidenceFrom(tradeScenario({ payer: "0.0.9999" }).mirror));
    expect(byId(result.checks, "same-key")).toMatchObject({
      status: "fail",
      detail: `the message was paid for by 0.0.9999, not by the agent ${AGENT_ID}`,
    });
  });

  it("fails same-key without a submit key, with a non-ECDSA key, or with another sender", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    const withKey = (topicSubmitKey: HederaKey | null) =>
      tampered(evidence, copy => {
        copy.message = copy.message && { ...copy.message, topicSubmitKey };
      });
    expect(byId(withKey(null).checks, "same-key").detail).toContain("has no submit key");
    expect(
      byId(
        withKey({ type: "ED25519", key: "15706b229b3ba33d4a5a41ff54ce1cfe0a3d308672a33ff382f81583e02bd743" }).checks,
        "same-key",
      ).detail,
    ).toContain("is ED25519");
    const otherSender = tampered(evidence, copy => {
      copy.from = longZeroAddress("0.0.9999");
    });
    expect(byId(otherSender.checks, "same-key").detail).toContain("the trade was sent by");
  });

  it("accepts the agent's alias as the sender as well as its long-zero address", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    const result = tampered(evidence, copy => {
      copy.from = AGENT_ADDRESS;
    });
    expect(result.verdict).toBe("verified");
  });

  it("fails content-match when the published record differs from the executed trade", async () => {
    // The agent published one amount and the vault executed another: the hash binds the record, not the trade.
    const record = tradeRecord();
    const published = tradeRecord({ action: record.action && { ...record.action, amountIn: "999999999" } });
    const result = evaluateTradeEvidence(await evidenceFrom(tradeScenario({ record: published }).mirror));
    expect(statuses(result.checks)).toEqual(allPassExcept({ "content-match": "fail" }));
    expect(byId(result.checks, "content-match").detail).toContain("amountIn: record 999999999, trade 1000000000");
  });

  it("fails only content-match when the receipt's amountIn is changed", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    const result = tampered(evidence, copy => {
      copy.receipt.amountIn = (BigInt(copy.receipt.amountIn) + 1n).toString();
    });
    expect(statuses(result.checks)).toEqual(allPassExcept({ "content-match": "fail" }));
  });

  it("only warns when the vault sold less than requested, as a partial fill does", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    expect(evidence.requestedAmountIn).toBe("1000000000");
    const result = tampered(evidence, copy => {
      copy.receipt.amountIn = "600000000";
    });
    expect(byId(result.checks, "content-match")).toMatchObject({
      status: "warn",
      detail: expect.stringContaining("the pool filled only 6 WHBAR of the 10 WHBAR requested"),
    });
    expect(result.verdict).toBe("verified");
  });

  it("fails content-match on another fee tier and warns when the fee tier is unknown", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    const otherFee = tampered(evidence, copy => {
      copy.poolFee = 1500;
    });
    expect(byId(otherFee.checks, "content-match").detail).toContain("poolFee: record 3000, trade 1500");
    const unknownFee = tampered(evidence, copy => {
      copy.poolFee = null;
    });
    expect(byId(unknownFee.checks, "content-match").status).toBe("warn");
    expect(unknownFee.verdict).toBe("verified");
  });

  it("fails schema-valid when the trade points at a hold record", async () => {
    const result = evaluateTradeEvidence(await evidenceFrom(tradeScenario({ record: holdRecord() }).mirror));
    expect(byId(result.checks, "schema-valid")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining('"hold" record'),
    });
    expect(byId(result.checks, "content-match").status).toBe("skip");
    expect(result.verdict).toBe("failed");
  });

  it("fails message-found when the sequence does not exist and skips the checks that need it", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    const result = tampered(evidence, copy => {
      copy.message = null;
    });
    expect(statuses(result.checks)).toEqual(
      allPassExcept({
        "message-found": "fail",
        "hash-match": "skip",
        ordering: "skip",
        "same-key": "skip",
        "schema-valid": "skip",
        "content-match": "skip",
      }),
    );
    expect(result.verdict).toBe("failed");
  });

  it("treats malformed base64 in edited evidence as a failure, not a crash", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    const result = tampered(evidence, copy => {
      copy.message = copy.message && { ...copy.message, raw: "%%% not base64 %%%" };
    });
    expect(byId(result.checks, "hash-match").status).toBe("fail");
    expect(byId(result.checks, "schema-valid").status).toBe("fail");
  });

  it("fails tx-success and topic-pinned on a changed result or topic", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    const result = tampered(evidence, copy => {
      copy.result = "CONTRACT_REVERT_EXECUTED";
      copy.vaultTopicNumAtBlock = "6300002";
    });
    expect(byId(result.checks, "tx-success").status).toBe("fail");
    expect(byId(result.checks, "topic-pinned").detail).toBe(
      `the receipt names topic ${TOPIC_ID}, but at block ${BLOCK} the vault's topic was 0.0.6300002`,
    );
  });
});

describe("vault-code", () => {
  it("fails a lookalike contract that emits a TradeExecuted-shaped event", async () => {
    const { mirror } = tradeScenario();
    // A contract that answers every view like the vault but is not AgentVault: here, its last code byte differs.
    const genuine = deployedVaultCode();
    const lookalike = `0x${genuine.slice(2, -2)}${genuine.endsWith("00") ? "01" : "00"}` as const;
    mirror.route(`/api/v1/contracts/${VAULT_ID}`, vaultContract(lookalike));
    const result = evaluateTradeEvidence(await evidenceFrom(mirror));
    expect(statuses(result.checks)).toEqual(allPassExcept({ "vault-code": "fail" }));
    expect(byId(result.checks, "vault-code").detail).toContain("does not run AgentVault's code");
    expect(result.verdict).toBe("failed");
  });

  it("fails a genuine AgentVault deployed against another router or Supra oracle", async () => {
    const { mirror } = tradeScenario();
    const vault = { address: VAULT, abi: agentVaultAbi } as const;
    stubView(mirror, BLOCK, { ...vault, functionName: "ROUTER", result: FEED });
    const result = evaluateTradeEvidence(await evidenceFrom(mirror));
    expect(byId(result.checks, "vault-code")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining(`ROUTER() is ${FEED}, not testnet's SaucerSwap router`),
    });
  });

  it("skips while the Mirror Node has no code for the vault", async () => {
    const { mirror } = tradeScenario();
    mirror.unroute(`/api/v1/contracts/${VAULT_ID}`);
    const result = evaluateTradeEvidence(await evidenceFrom(mirror));
    expect(statuses(result.checks)).toEqual(allPassExcept({ "vault-code": "skip" }));
    expect(result.verdict).toBe("incomplete");
  });
});

describe("oracle-match", () => {
  it("fails when the oracle on chain disagrees with the receipt at the same update time", async () => {
    const { mirror } = tradeScenario();
    stubView(mirror, BLOCK, {
      address: FEED,
      abi: chainlinkAggregatorAbi,
      functionName: "latestRoundData",
      result: [1n, 10_300_000n, 1_789_999_990n, 1_789_999_990n, 1n],
    });
    const result = evaluateTradeEvidence(await evidenceFrom(mirror));
    expect(statuses(result.checks)).toEqual(allPassExcept({ "oracle-match": "fail" }));
    expect(byId(result.checks, "oracle-match").detail).toContain(
      "WHBAR: priceE18 102450000000000000 in the receipt but 103000000000000000 on chain",
    );
  });

  it("skips, rather than fails, when an oracle updated again later in the same block", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    const result = tampered(evidence, copy => {
      const later = copy.oracleAtBlock?.tokenIn;
      if (later) Object.assign(later, { priceE18: "103000000000000000", updatedAt: later.updatedAt + 2 });
    });
    expect(byId(result.checks, "oracle-match")).toMatchObject({
      status: "skip",
      detail: expect.stringContaining("updated again later in block"),
    });
    expect(result.verdict).toBe("incomplete");
  });
});

describe("atomic-trace", () => {
  const actionsPath = `/api/v1/contracts/results/${TX_HASH}/actions`;

  it("fails when the vault swapped without reading one of the configured oracles", async () => {
    const { mirror } = tradeScenario();
    // Drop the USDC price read (Supra pair 89) and its proxy hop.
    mirror.route(actionsPath, {
      actions: tradeActions().filter(call => call.index !== 6 && call.index !== 7),
      links: { next: null },
    });
    const result = evaluateTradeEvidence(await evidenceFrom(mirror));
    expect(statuses(result.checks)).toEqual(allPassExcept({ "atomic-trace": "fail" }));
    expect(byId(result.checks, "atomic-trace").detail).toBe("the vault swapped without first reading Supra pair 89");
  });

  it("fails when an oracle is read only after the swap", async () => {
    const { mirror } = tradeScenario();
    const actions = tradeActions().map(call =>
      call.index === 1 || call.index === 2 ? { ...call, index: call.index + 20 } : call,
    );
    mirror.route(actionsPath, { actions, links: { next: null } });
    const result = evaluateTradeEvidence(await evidenceFrom(mirror));
    expect(byId(result.checks, "atomic-trace").detail).toBe(
      `the vault swapped without first reading Chainlink ${FEED.slice(0, 6)}…${FEED.slice(-4)} (only after the swap)`,
    );
  });

  it("fails when the swap did not go through the SaucerSwap router", async () => {
    const { mirror } = tradeScenario();
    const actions = tradeActions().map(call =>
      call.index === 10 ? action(10, 1, VAULT_ID, "0.0.1234567", call.input) : call,
    );
    mirror.route(actionsPath, { actions, links: { next: null } });
    const result = evaluateTradeEvidence(await evidenceFrom(mirror));
    expect(byId(result.checks, "atomic-trace").detail).toContain("never called exactInput on the SaucerSwap router");
  });
});

describe("Mirror Node lag", () => {
  it("returns an incomplete verdict, never a failure, while state and the trace are unavailable", async () => {
    const { mirror } = tradeScenario();
    mirror.unroute(`/api/v1/contracts/results/${TX_HASH}/actions`);
    mirror.failContractCalls({ status: 400, message: "Bad Request: Unknown block number" });

    serve(mirror);

    const proof = await verifyTrade({ network: "testnet", tx: TX_HASH, mirrorUrl: MIRROR_URL });

    expect(statuses(proof.checks)).toEqual(
      allPassExcept({
        "vault-code": "skip",
        "topic-pinned": "skip",
        "same-key": "skip",
        "oracle-match": "skip",
        "atomic-trace": "skip",
        "execution-quality": "skip",
      }),
    );
    expect(proof.verdict).toBe("incomplete");
  });
});

describe("execution-quality", () => {
  it("passes within the slippage policy and fails beyond it", async () => {
    const evidence = await evidenceFrom(tradeScenario().mirror);
    const withinPolicy = tampered(evidence, copy => {
      copy.receipt.amountOut = "1000000";
    });
    expect(byId(withinPolicy.checks, "execution-quality")).toMatchObject({
      status: "pass",
      detail: "received 1 USDC, 239 bps below the oracle-fair 1.024529 USDC, within the 300 bps policy",
    });
    const beyondPolicy = tampered(evidence, copy => {
      copy.receipt.amountOut = "990000";
    });
    expect(byId(beyondPolicy.checks, "execution-quality")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("beyond the 300 bps policy"),
    });
    expect(beyondPolicy.verdict).toBe("failed");
  });
});

/** The contract result the scenario serves, to derive variants from. */
async function contractResultBody(mirror: FakeMirror): Promise<Record<string, unknown>> {
  const response = await mirror.fetch(`${MIRROR_URL}/api/v1/contracts/results/${TX_HASH}`);
  return (await response.json()) as Record<string, unknown>;
}
