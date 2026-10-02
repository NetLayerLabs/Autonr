import { useState } from "react";
import { agentVaultAbi } from "@sh/agent/abi";
import { useQueryClient } from "@tanstack/react-query";
import type { Address, Hash } from "viem";
import { useWriteContract } from "wagmi";
import { AUTONR_QUERY_KEY } from "~~/hooks/autonr/useAutonrApi";
import { useTransactor } from "~~/hooks/scaffold-hbar";

type VaultTarget = { address: Address; abi: typeof agentVaultAbi; chainId: number };

/**
 * Sends owner transactions to the vault. useTransactor shows wallet prompts, waits for the receipt and reports a
 * revert with the vault's decoded custom error, e.g. InvalidPolicy.
 */
export function useVaultWriter(vault: Address, chainId: number) {
  const { writeContractAsync } = useWriteContract();
  const transactor = useTransactor();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const send = async (action: string, write: (target: VaultTarget) => Promise<Hash>) => {
    setPending(action);
    try {
      await transactor(() => write({ address: vault, abi: agentVaultAbi, chainId }));
      await queryClient.invalidateQueries({ queryKey: [AUTONR_QUERY_KEY, "vault"] });
    } catch {
      // Already reported: useTransactor turned the failure into a notification before rethrowing.
    } finally {
      setPending(null);
    }
  };

  return { send, pending, writeContractAsync };
}

export type VaultWriter = ReturnType<typeof useVaultWriter>;
