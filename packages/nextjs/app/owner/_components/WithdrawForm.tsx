"use client";

import { type FormEvent, useState } from "react";
import type { VaultWriter } from "./useVaultWriter";
import { type Address, erc20Abi, formatUnits, isAddress, parseUnits } from "viem";
import { useReadContracts } from "wagmi";
import { Panel } from "~~/components/autonr/Panel";
import type { VaultToken } from "~~/lib/api/types";
import { formatTokenAmount } from "~~/lib/format";

type WithdrawFormProps = {
  vault: Address;
  chainId: number;
  tokens: VaultToken[];
  owner: string;
  canWrite: boolean;
  writer: VaultWriter;
};

type WithdrawableToken = Pick<VaultToken, "address" | "symbol" | "decimals" | "balance">;

const OTHER_TOKEN = "other";

export const WithdrawForm = ({ vault, chainId, tokens, owner, canWrite, writer }: WithdrawFormProps) => {
  const [tokenAddress, setTokenAddress] = useState<string>(tokens[0]?.address ?? OTHER_TOKEN);
  const [otherAddress, setOtherAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState(owner);
  // Tokens sent to the vault by mistake, or removed from its configuration, are withdrawn by address.
  const other = useOtherToken(otherAddress.trim(), vault, chainId, tokenAddress === OTHER_TOKEN);
  const token: WithdrawableToken | undefined =
    tokenAddress === OTHER_TOKEN ? other.token : tokens.find(candidate => candidate.address === tokenAddress);

  const raw = token ? parseAmount(amount, token.decimals) : null;
  const exceeds = token !== undefined && raw !== null && raw > BigInt(token.balance);
  const recipientValid = isAddress(recipient.trim());
  const ready = token !== undefined && raw !== null && raw > 0n && !exceeds && recipientValid;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || !token || raw === null) return;
    const to = recipient.trim();
    if (!isAddress(to)) return;
    void writer.send("withdraw", target =>
      writer.writeContractAsync({ ...target, functionName: "withdraw", args: [token.address, raw, to] }),
    );
  };

  if (!canWrite) return null;

  return (
    <Panel title="Withdraw" description="Owner only, and allowed while paused. The agent has no withdrawal path.">
      <form
        onSubmit={submit}
        noValidate
        className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_1fr_2fr_auto]"
      >
        <label className="flex flex-col gap-1 text-xs">
          Token
          <select
            value={tokenAddress}
            onChange={event => setTokenAddress(event.target.value)}
            className="select select-sm"
          >
            {tokens.map(option => (
              <option key={option.address} value={option.address}>
                {option.symbol}
              </option>
            ))}
            <option value={OTHER_TOKEN}>Other address…</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="flex justify-between gap-2">
            Amount
            {token && (
              <button
                type="button"
                className="link font-medium"
                onClick={() => setAmount(formatUnits(BigInt(token.balance), token.decimals))}
              >
                Max {formatTokenAmount(token.balance, token.decimals)}
              </button>
            )}
          </span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={event => setAmount(event.target.value)}
            aria-invalid={amount !== "" && (raw === null || exceeds)}
            className={`input input-sm w-full font-mono tabular-nums ${
              amount !== "" && (raw === null || exceeds) ? "input-error" : ""
            }`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Recipient
          <input
            value={recipient}
            onChange={event => setRecipient(event.target.value)}
            aria-invalid={!recipientValid}
            className={`input input-sm w-full font-mono ${recipientValid ? "" : "input-error"}`}
          />
        </label>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!ready || writer.pending !== null}>
          {writer.pending === "withdraw" && <span className="loading loading-spinner loading-xs" aria-hidden />}
          Withdraw
        </button>
        {tokenAddress === OTHER_TOKEN && (
          <label className="flex flex-col gap-1 text-xs sm:col-span-2 lg:col-span-4">
            Token address
            <input
              value={otherAddress}
              onChange={event => setOtherAddress(event.target.value)}
              placeholder="0x…"
              aria-invalid={otherAddress !== "" && other.error !== null}
              className={`input input-sm w-full font-mono ${otherAddress !== "" && other.error ? "input-error" : ""}`}
            />
            {otherAddress !== "" && other.error && <span className="font-medium">{other.error}</span>}
          </label>
        )}
        {exceeds && <p className="m-0 text-xs font-medium sm:col-span-2">The amount is more than the vault holds.</p>}
        <p className="m-0 text-xs text-base-content/70 sm:col-span-2 lg:col-span-4">
          The recipient must be associated with the token on Hedera, or the transfer reverts.
        </p>
      </form>
    </Panel>
  );
};

function parseAmount(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  const pattern = decimals > 0 ? new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`) : /^\d+$/;
  return pattern.test(trimmed) ? parseUnits(trimmed, decimals) : null;
}

/** Reads an arbitrary ERC-20 or HTS token's decimals, symbol and vault balance, so it can be withdrawn by address. */
function useOtherToken(input: string, vault: Address, chainId: number, enabled: boolean) {
  const address = isAddress(input) ? input : undefined;
  const reads = useReadContracts({
    contracts: address
      ? [
          { address, abi: erc20Abi, functionName: "decimals", chainId },
          { address, abi: erc20Abi, functionName: "symbol", chainId },
          { address, abi: erc20Abi, functionName: "balanceOf", args: [vault], chainId },
        ]
      : [],
    query: { enabled: enabled && address !== undefined },
  });
  if (!address) return { token: undefined, error: "Enter the token's EVM address." };
  const [decimals, symbol, balance] = reads.data ?? [];
  if (decimals?.status !== "success" || balance?.status !== "success") {
    return { token: undefined, error: reads.isLoading ? null : "Could not read this token's decimals and balance." };
  }
  const token: WithdrawableToken = {
    address,
    symbol: symbol?.status === "success" ? symbol.result : "tokens",
    decimals: decimals.result,
    balance: balance.result.toString(),
  };
  return { token, error: null };
}
