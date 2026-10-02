"use client";

import { AgentForm } from "./AgentForm";
import { PolicyForm } from "./PolicyForm";
import { PoolFeeForm } from "./PoolFeeForm";
import { TokensSection } from "./TokensSection";
import { WithdrawForm } from "./WithdrawForm";
import { type VaultWriter, useVaultWriter } from "./useVaultWriter";
import { hashscanUrl } from "@sh/agent/hedera";
import type { NetworkName } from "@sh/agent/networks";
import type { Address } from "viem";
import { hedera, hederaTestnet } from "viem/chains";
import { useAccount, useSwitchChain } from "wagmi";
import { LockClosedIcon } from "@heroicons/react/20/solid";
import { EmptyState } from "~~/components/autonr/EmptyState";
import { EntityId } from "~~/components/autonr/EntityId";
import { Panel } from "~~/components/autonr/Panel";
import { QueryBoundary } from "~~/components/autonr/QueryBoundary";
import { HederaAddress } from "~~/components/scaffold-hbar";
import { useVault } from "~~/hooks/autonr/useAutonrApi";
import type { VaultState } from "~~/lib/api/types";

export const OwnerConsole = () => {
  const vault = useVault();
  return (
    <QueryBoundary query={vault} skeletonLines={8}>
      {data =>
        data.configured ? (
          <OwnerControls network={data.network} vault={data.vault} />
        ) : (
          <Panel title="No vault">
            <EmptyState reason={data.reason} commands={data.commands} />
          </Panel>
        )
      }
    </QueryBoundary>
  );
};

const OwnerControls = ({ network, vault }: { network: NetworkName; vault: VaultState }) => {
  const chain = network === "mainnet" ? hedera : hederaTestnet;
  const { address, chainId, isConnected } = useAccount();
  const isOwner = address !== undefined && address.toLowerCase() === vault.owner.toLowerCase();
  const canWrite = isOwner && chainId === chain.id;
  const writer = useVaultWriter(vault.address, chain.id);

  return (
    <div className="flex flex-col gap-4">
      <AccessBanner
        network={network}
        vault={vault}
        isConnected={isConnected}
        isOwner={isOwner}
        connected={address}
        wrongChain={isOwner && chainId !== chain.id}
        chain={chain}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <PausePanel paused={vault.paused} canWrite={canWrite} writer={writer} />
        <AgentForm network={network} agent={vault.agent} canWrite={canWrite} writer={writer} />
      </div>
      <PolicyForm key={vault.address} policy={vault.policy} canWrite={canWrite} writer={writer} />
      <TokensSection network={network} tokens={vault.tokens} canWrite={canWrite} writer={writer} />
      <PoolFeeForm
        key={`${vault.address}-${vault.poolFee}`}
        tokens={vault.tokens}
        poolFee={vault.poolFee}
        canWrite={canWrite}
        writer={writer}
      />
      <WithdrawForm
        vault={vault.address}
        chainId={chain.id}
        tokens={vault.tokens}
        owner={address ?? vault.owner}
        canWrite={canWrite}
        writer={writer}
      />
    </div>
  );
};

type AccessBannerProps = {
  network: NetworkName;
  vault: VaultState;
  isConnected: boolean;
  isOwner: boolean;
  connected: Address | undefined;
  wrongChain: boolean;
  chain: typeof hedera | typeof hederaTestnet;
};

const AccessBanner = ({ network, vault, isConnected, isOwner, connected, wrongChain, chain }: AccessBannerProps) => {
  const { switchChain, isPending } = useSwitchChain();
  const message = !isConnected
    ? "Connect the owner wallet to change settings. Everyone else sees the vault read-only."
    : !isOwner
      ? "The connected wallet is not the vault owner, so the controls are read-only."
      : wrongChain
        ? `Switch your wallet to ${chain.name} to send owner transactions.`
        : "Connected as the owner. Each change is one transaction signed by your wallet.";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-box border border-base-300 bg-base-100 p-4">
      <div className="flex min-w-0 items-start gap-2 text-sm">
        <LockClosedIcon className="mt-0.5 h-4 w-4 shrink-0 text-base-content/70" aria-hidden />
        <div className="min-w-0">
          <p className="m-0">{message}</p>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 text-xs text-base-content/70">
            Owner <EntityId value={vault.owner} href={hashscanUrl(network, "account", vault.owner)} short />
            · Vault <EntityId value={vault.address} href={hashscanUrl(network, "contract", vault.address)} short />
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {connected && <HederaAddress address={connected} chain={chain} />}
        {wrongChain && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={isPending}
            onClick={() => switchChain({ chainId: chain.id })}
          >
            Switch to {chain.name}
          </button>
        )}
      </div>
    </div>
  );
};

type PausePanelProps = { paused: boolean; canWrite: boolean; writer: VaultWriter };

const PausePanel = ({ paused, canWrite, writer }: PausePanelProps) => (
  <Panel
    title="Trading switch"
    description="Pausing stops executeSwap immediately. Withdrawals keep working while paused."
  >
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 text-sm">
        The vault is <span className="font-semibold">{paused ? "paused" : "active"}</span>.
      </p>
      <button
        type="button"
        className={`btn btn-sm ${paused ? "btn-primary" : "btn-error"}`}
        disabled={!canWrite || writer.pending !== null}
        onClick={() =>
          void writer.send(paused ? "unpause" : "pause", target =>
            writer.writeContractAsync({ ...target, functionName: paused ? "unpause" : "pause" }),
          )
        }
      >
        {writer.pending === "pause" || writer.pending === "unpause" ? (
          <span className="loading loading-spinner loading-xs" aria-hidden />
        ) : null}
        {paused ? "Unpause trading" : "Pause trading"}
      </button>
    </div>
  </Panel>
);
