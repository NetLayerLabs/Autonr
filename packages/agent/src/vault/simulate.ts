import { type Address, type Hex } from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { type HederaPublicClient } from "../chain";
import { decodeRevertData, revertDataOf, type VaultError } from "./errors";

/** IAgentVault.SwapRequest. */
type SwapRequest = { tokenIn: Address; tokenOut: Address; poolFee: number; amountIn: bigint };

/** IAgentVault.Reasoning: keccak256 of the HCS message bytes and its sequence number on the vault's topic. */
type Reasoning = { hash: Hex; sequence: bigint };

export type SwapCall = { vault: Address; request: SwapRequest; reasoning: Reasoning };

export type SimulationResult = { ok: true; amountOut: bigint } | { ok: false; error: VaultError };

/**
 * Runs executeSwap as an eth_call from `from` at `blockNumber`, so nothing is signed or spent. Pinning the block makes
 * the answer reproducible: anyone can re-execute the same call at the same block through the Mirror Node.
 * Reverts come back as decoded vault errors; failures that are not reverts (network, relay prechecks) throw.
 */
export async function simulateSwap(
  client: HederaPublicClient,
  call: SwapCall,
  from: Address,
  blockNumber: bigint,
): Promise<SimulationResult> {
  try {
    const { result } = await client.simulateContract({
      address: call.vault,
      abi: agentVaultAbi,
      functionName: "executeSwap",
      args: [call.request, call.reasoning],
      account: from,
      blockNumber,
    });
    return { ok: true, amountOut: result };
  } catch (error) {
    const data = revertDataOf(error);
    if (data === undefined) throw error;
    return { ok: false, error: decodeRevertData(data) };
  }
}
