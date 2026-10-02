import { encodeFunctionData, type Hex, isAddressEqual, isHex, parseEventLogs } from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { type HederaPublicClient, type HederaWalletClient, sendContractCall, waitForReceipt } from "../chain";
import { MirrorClient, MirrorNotFoundError, MirrorRequestError } from "../mirror";
import { decodeRevertData, revertDataOf, type VaultError } from "./errors";
import { type SwapCall } from "./simulate";

export type ExecutionResult =
  | { ok: true; txHash: Hex; tradeId: number; amountIn: bigint; amountOut: bigint }
  /** `txHash` is null when the call reverted during gas estimation and nothing was sent. */
  | { ok: false; txHash: Hex | null; error: VaultError };

/**
 * Sends executeSwap from the agent's wallet and waits for the receipt. Returns the TradeExecuted figures, or the
 * decoded revert. Throws only when the outcome is unknown (the relay failed before or after accepting the transaction).
 */
export async function executeSwap(
  client: HederaPublicClient,
  wallet: HederaWalletClient,
  call: SwapCall,
  mirrorUrl: string,
): Promise<ExecutionResult> {
  const data = encodeFunctionData({
    abi: agentVaultAbi,
    functionName: "executeSwap",
    args: [call.request, call.reasoning],
  });
  let txHash: Hex;
  try {
    txHash = await sendContractCall(client, wallet, { to: call.vault, data });
  } catch (error) {
    const revert = revertDataOf(error);
    if (revert === undefined) throw error;
    return { ok: false, txHash: null, error: decodeRevertData(revert) };
  }

  const receipt = await waitForReceipt(client, txHash);
  if (receipt.status === "reverted") return { ok: false, txHash, error: await revertReason(mirrorUrl, txHash) };

  const [trade] = parseEventLogs({ abi: agentVaultAbi, eventName: "TradeExecuted", logs: receipt.logs }).filter(log =>
    isAddressEqual(log.address, call.vault),
  );
  if (!trade) throw new Error(`transaction ${txHash} succeeded but the vault emitted no TradeExecuted event`);
  return {
    ok: true,
    txHash,
    tradeId: Number(trade.args.tradeId),
    amountIn: trade.args.receipt.amountIn,
    amountOut: trade.args.receipt.amountOut,
  };
}

/** How long to wait for the Mirror Node to import a contract result that the relay already reported. */
const IMPORT_ATTEMPTS = 5;
const IMPORT_RETRY_MS = 1_500;

/**
 * A JSON-RPC receipt only says "reverted". The Mirror Node keeps the revert data of every contract result, which is
 * where the vault's custom error lives; it can trail the relay by a few seconds, so a result it has not imported yet is
 * awaited. The revert itself is certain, so a Mirror Node that cannot answer yields "Unknown" rather than an error:
 * the rejection still gets recorded.
 */
async function revertReason(mirrorUrl: string, txHash: Hex): Promise<VaultError> {
  const mirror = new MirrorClient({ baseUrl: mirrorUrl });
  let problem = "not imported yet";
  for (let attempt = 1; attempt <= IMPORT_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await new Promise(resolve => setTimeout(resolve, IMPORT_RETRY_MS));
    try {
      const { result, error_message: message } = await mirror.contractResult(txHash);
      if (message && isHex(message)) return decodeRevertData(message);
      return { name: result, detail: message || `the transaction failed with status ${result}` };
    } catch (error) {
      if (error instanceof MirrorNotFoundError) continue;
      // The client has already retried rate limits and outages; another round would not change the answer.
      if (!(error instanceof MirrorRequestError)) throw error;
      problem = error.status === null ? "no response" : `HTTP ${error.status}`;
      break;
    }
  }
  return { name: "Unknown", detail: `reverted; the Mirror Node did not return the revert data (${problem})` };
}
