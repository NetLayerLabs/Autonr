import { encodeErrorResult, encodeFunctionData, encodeFunctionResult, keccak256, numberToHex, toBytes } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentVaultAbi } from "../../src/abi/agentVault";
import { type DecisionRecord, type Replay } from "../../src/decision";
import { replayRejection } from "../../src/verify";
import { FakeMirror } from "./fake-mirror";
import {
  AGENT_ADDRESS,
  hcsMessage,
  holdRecord,
  MIRROR_URL,
  rejectedRecord,
  TOPIC_ID,
  USDC,
  VAULT,
  WHBAR,
} from "./fixtures";

const SIMULATED_AT = 40_999_000;
const SIMULATION_HASH = keccak256(toBytes("autonr:simulation"));
const replay: Replay = { block: SIMULATED_AT, from: AGENT_ADDRESS, reasoningHash: SIMULATION_HASH, sequence: 43 };
const dailyCapRecord = rejectedRecord({
  stage: "simulation",
  error: "DailyCapExceeded",
  detail: "trade $5.00 exceeds the $0.00 left in today's cap",
  replay,
});

/** The executeSwap call the agent simulated, rebuilt from the record exactly as the verifier must. */
const simulatedCall = encodeFunctionData({
  abi: agentVaultAbi,
  functionName: "executeSwap",
  args: [
    { tokenIn: WHBAR, tokenOut: USDC, poolFee: 3000, amountIn: 1_000_000_000n },
    { hash: SIMULATION_HASH, sequence: 43n },
  ],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mirrorWith(record: DecisionRecord | string, sequence = 44): FakeMirror {
  const mirror = new FakeMirror().route(
    `/api/v1/topics/${TOPIC_ID}/messages/${sequence}`,
    hcsMessage(sequence, record),
  );
  vi.stubGlobal("fetch", mirror.fetch);
  return mirror;
}

function replayAt(sequence = 44) {
  return replayRejection({ network: "testnet", topicId: TOPIC_ID, sequence, mirrorUrl: MIRROR_URL });
}

describe("replayRejection", () => {
  it("reproduces the recorded custom error from the same sender at the same block", async () => {
    const mirror = mirrorWith(dailyCapRecord);
    const revert = encodeErrorResult({
      abi: agentVaultAbi,
      errorName: "DailyCapExceeded",
      args: [5n * 10n ** 18n, 0n],
    });
    mirror.contractCall(VAULT, simulatedCall, SIMULATED_AT, { revert });

    const result = await replayAt();

    expect(result).toMatchObject({
      sequence: 44,
      expectedError: "DailyCapExceeded",
      replayedError: "DailyCapExceeded",
      reproduced: true,
    });
    expect(result.detail).toContain(`at block ${SIMULATED_AT} the vault refused the same call again`);
    expect(mirror.contractCallBodies).toEqual([
      { to: VAULT, from: AGENT_ADDRESS, data: simulatedCall, block: numberToHex(SIMULATED_AT), estimate: false },
    ]);
  });

  it("reports a different error as not reproduced", async () => {
    const mirror = mirrorWith(dailyCapRecord);
    const revert = encodeErrorResult({
      abi: agentVaultAbi,
      errorName: "TradeTooLarge",
      args: [5n * 10n ** 18n, 10n ** 18n],
    });
    mirror.contractCall(VAULT, simulatedCall, SIMULATED_AT, { revert });

    const result = await replayAt();

    expect(result).toMatchObject({
      expectedError: "DailyCapExceeded",
      replayedError: "TradeTooLarge",
      reproduced: false,
    });
  });

  it("reports a call that now succeeds as not reproduced", async () => {
    const mirror = mirrorWith(dailyCapRecord);
    const success = encodeFunctionResult({ abi: agentVaultAbi, functionName: "executeSwap", result: 1_030_000n });
    mirror.contractCall(VAULT, simulatedCall, SIMULATED_AT, { result: success });

    const result = await replayAt();

    expect(result).toMatchObject({ replayedError: null, reproduced: false });
    expect(result.detail).toBe(
      `executeSwap succeeds at block ${SIMULATED_AT}, so the recorded DailyCapExceeded was not reproduced`,
    );
  });

  it("refuses decisions that cannot be replayed", async () => {
    mirrorWith(holdRecord());
    await expect(replayAt()).rejects.toMatchObject({
      code: "not-replayable",
      message: expect.stringContaining('a "hold" decision'),
    });

    mirrorWith("not json {");
    await expect(replayAt()).rejects.toMatchObject({
      code: "not-replayable",
      message: expect.stringContaining("not valid JSON"),
    });

    const txHash = `0x${"12".repeat(32)}`;
    mirrorWith(
      rejectedRecord({ stage: "execution", error: "InsufficientOutput", detail: "", decisionSeq: 43, txHash }),
    );
    await expect(replayAt()).rejects.toMatchObject({
      code: "not-replayable",
      message: expect.stringContaining(txHash),
    });
  });

  it("reports a message that does not exist", async () => {
    mirrorWith(dailyCapRecord);
    await expect(replayAt(45)).rejects.toMatchObject({ code: "not-found" });
    await expect(replayAt(0)).rejects.toMatchObject({ code: "invalid-input" });
  });
});
