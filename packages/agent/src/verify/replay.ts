import { encodeFunctionData, getAddress, type Hex } from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { ContractCallRevertedError, orNull } from "../mirror";
import { type NetworkName } from "../networks";
import { decodeRevertData } from "../vault/errors";
import { decisionEntry } from "./decisions";
import { VerifyError } from "./errors";
import { mirrorFor, sequenceInput, topicIdInput } from "./input";
import { type ReplayResult } from "./types";

/**
 * Re-runs a refused trade exactly as the agent simulated it: the same executeSwap calldata, from the same address,
 * against the state at the same block, executed by the Mirror Node. Getting the recorded custom error back proves the
 * vault, not the agent, refused the trade.
 */
export async function replayRejection(input: {
  network: NetworkName;
  topicId: string;
  sequence: number;
  mirrorUrl?: string;
}): Promise<ReplayResult> {
  const topicId = topicIdInput(input.topicId);
  const sequence = sequenceInput(input.sequence);
  const mirror = mirrorFor(input.network, input.mirrorUrl);
  const message = await orNull(mirror.topicMessage(topicId, sequence));
  if (!message) throw new VerifyError("not-found", `topic ${topicId} has no message ${sequence} on ${input.network}`);

  const { record, error } = decisionEntry(message);
  if (!record) throw new VerifyError("not-replayable", `message ${sequence} is not a valid decision record: ${error}`);
  const { rejection, action } = record;
  if (record.kind !== "rejected" || !rejection) {
    const reason = `message ${sequence} is a "${record.kind}" decision; only rejected decisions can be replayed`;
    throw new VerifyError("not-replayable", reason);
  }
  if (!rejection.replay || !action) {
    const pointer = rejection.txHash ? `; its reverted transaction ${rejection.txHash} is on HashScan instead` : "";
    const reason = `the ${rejection.stage}-stage rejection in message ${sequence} has no replay data${pointer}`;
    throw new VerifyError("not-replayable", reason);
  }

  const { block, from, reasoningHash, sequence: reasoningSequence } = rejection.replay;
  const data = encodeFunctionData({
    abi: agentVaultAbi,
    functionName: "executeSwap",
    args: [
      {
        tokenIn: getAddress(action.tokenIn),
        tokenOut: getAddress(action.tokenOut),
        poolFee: action.poolFee,
        amountIn: BigInt(action.amountIn),
      },
      // The decision schema has already checked this is a 0x-prefixed 32-byte hash.
      { hash: reasoningHash as Hex, sequence: BigInt(reasoningSequence) },
    ],
  });
  const expectedError = rejection.error;
  try {
    await mirror.call({ to: getAddress(record.vault), from: getAddress(from), data, block });
  } catch (callError) {
    if (!(callError instanceof ContractCallRevertedError)) throw callError;
    const replayed = decodeRevertData(callError.data);
    const reproduced = replayed.name === expectedError;
    const detail = reproduced
      ? `at block ${block} the vault refused the same call again: ${replayed.detail}`
      : `at block ${block} the vault refused it with ${replayed.name} (${replayed.detail}), not ${expectedError}`;
    return { sequence, expectedError, replayedError: replayed.name, reproduced, detail };
  }
  const detail = `executeSwap succeeds at block ${block}, so the recorded ${expectedError} was not reproduced`;
  return { sequence, expectedError, replayedError: null, reproduced: false, detail };
}
