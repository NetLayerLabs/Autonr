"use client";

import { type FormEvent, useState } from "react";
import type { VaultWriter } from "./useVaultWriter";
import { entityIdFromLongZero, hashscanUrl } from "@sh/agent/hedera";
import type { NetworkName, TokenRef } from "@sh/agent/networks";
import { type Address, isAddress, zeroAddress } from "viem";
import { EntityId } from "~~/components/autonr/EntityId";
import { Panel } from "~~/components/autonr/Panel";
import { useHealth } from "~~/hooks/autonr/useAutonrApi";
import type { VaultToken } from "~~/lib/api/types";
import { formatTokenAmount } from "~~/lib/format";

type TokensSectionProps = { network: NetworkName; tokens: VaultToken[]; canWrite: boolean; writer: VaultWriter };

type Draft = { token: string; chainlinkFeed: string; supraPairId: string; supraEnabled: boolean };

const EMPTY_DRAFT: Draft = { token: "", chainlinkFeed: "", supraPairId: "", supraEnabled: true };

const UINT32_MAX = 4_294_967_295;

/** HTS tokens have token pages on HashScan; their EVM address is the long-zero form of the token id. */
function tokenHref(network: NetworkName, address: Address): string {
  const tokenId = entityIdFromLongZero(address);
  return tokenId ? hashscanUrl(network, "token", tokenId) : hashscanUrl(network, "contract", address);
}

function draftFrom(ref: TokenRef): Draft {
  return {
    token: ref.address,
    chainlinkFeed: ref.chainlinkFeed ?? "",
    supraPairId: String(ref.supraPairId),
    supraEnabled: true,
  };
}

export const TokensSection = ({ network, tokens, canWrite, writer }: TokensSectionProps) => {
  const health = useHealth().data;
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const presets = health ? [health.baseToken, health.quoteToken] : [];

  const tokenInput = draft.token.trim();
  const feedInput = draft.chainlinkFeed.trim();
  const pairInput = draft.supraPairId.trim();
  const token = isAddress(tokenInput) ? tokenInput : null;
  // An empty feed means "priced by Supra alone", which the vault encodes as the zero address.
  const feed = feedInput === "" ? zeroAddress : isAddress(feedInput) ? feedInput : null;
  const pairId = /^\d+$/.test(pairInput) && Number(pairInput) <= UINT32_MAX ? Number(pairInput) : null;
  // Mirrors the vault's NoPriceSource rule: a token needs a Chainlink feed, Supra, or both.
  const hasPriceSource = feed !== zeroAddress || draft.supraEnabled;

  const configure = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !feed || pairId === null || !hasPriceSource) return;
    void writer.send("configureToken", target =>
      writer.writeContractAsync({
        ...target,
        functionName: "configureToken",
        args: [token, feed, pairId, draft.supraEnabled],
      }),
    );
  };

  const associate = () => {
    if (!token) return;
    void writer.send("associateToken", target =>
      writer.writeContractAsync({ ...target, functionName: "associateToken", args: [token] }),
    );
  };

  return (
    <Panel
      title="Tokens"
      description="Only configured tokens can be traded. Each one is priced by its Chainlink feed with a Supra cross-check, or by Supra alone."
    >
      <div className="flex flex-col gap-5">
        {tokens.length === 0 ? (
          <p className="m-0 text-sm">No tokens are configured yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">Pricing</th>
                  <th scope="col" className="text-right">
                    Balance
                  </th>
                  {canWrite && (
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {tokens.map(vaultToken => (
                  <tr key={vaultToken.address}>
                    <td>
                      <span className="block font-medium">{vaultToken.symbol}</span>
                      <EntityId value={vaultToken.address} href={tokenHref(network, vaultToken.address)} short />
                    </td>
                    <td className="text-xs">
                      {vaultToken.chainlinkFeed ? (
                        <>
                          Chainlink <EntityId value={vaultToken.chainlinkFeed} short />
                          {vaultToken.supraPairId !== null && ` + Supra pair ${vaultToken.supraPairId}`}
                        </>
                      ) : (
                        `Supra pair ${vaultToken.supraPairId ?? "-"}`
                      )}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {formatTokenAmount(vaultToken.balance, vaultToken.decimals)}
                    </td>
                    {canWrite && (
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          disabled={writer.pending !== null}
                          onClick={() =>
                            void writer.send("removeToken", target =>
                              writer.writeContractAsync({
                                ...target,
                                functionName: "removeToken",
                                args: [vaultToken.address],
                              }),
                            )
                          }
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canWrite && (
          <form onSubmit={configure} noValidate className="flex flex-col gap-3 border-t border-base-300 pt-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Add or update a token</span>
              {presets.map(preset => (
                <button
                  key={preset.address}
                  type="button"
                  className="btn btn-xs"
                  onClick={() => setDraft(draftFrom(preset))}
                >
                  Use {preset.symbol} defaults
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs">
                Token address
                <input
                  value={draft.token}
                  onChange={event => setDraft(previous => ({ ...previous, token: event.target.value }))}
                  placeholder="0x…"
                  aria-invalid={tokenInput !== "" && !token}
                  className={`input input-sm w-full font-mono ${tokenInput !== "" && !token ? "input-error" : ""}`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Chainlink feed (optional)
                <input
                  value={draft.chainlinkFeed}
                  onChange={event => setDraft(previous => ({ ...previous, chainlinkFeed: event.target.value }))}
                  placeholder="0x… or empty for Supra only"
                  aria-invalid={!feed}
                  className={`input input-sm w-full font-mono ${feed ? "" : "input-error"}`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Supra pair id
                <input
                  inputMode="numeric"
                  value={draft.supraPairId}
                  onChange={event => setDraft(previous => ({ ...previous, supraPairId: event.target.value }))}
                  placeholder="75 = HBAR_USDT, 89 = USDC_USD"
                  aria-invalid={pairInput !== "" && pairId === null}
                  className={`input input-sm w-full font-mono ${pairInput !== "" && pairId === null ? "input-error" : ""}`}
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={draft.supraEnabled}
                  onChange={event => setDraft(previous => ({ ...previous, supraEnabled: event.target.checked }))}
                />
                Use Supra
              </label>
            </div>
            {!hasPriceSource && (
              <p className="m-0 text-xs font-medium">A token needs a Chainlink feed, Supra, or both (NoPriceSource).</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-sm"
                disabled={!token || writer.pending !== null}
                onClick={associate}
              >
                {writer.pending === "associateToken" && (
                  <span className="loading loading-spinner loading-xs" aria-hidden />
                )}
                1. Associate with the vault
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!token || !feed || pairId === null || !hasPriceSource || writer.pending !== null}
              >
                {writer.pending === "configureToken" && (
                  <span className="loading loading-spinner loading-xs" aria-hidden />
                )}
                2. Configure pricing
              </button>
            </div>
            <p className="m-0 text-xs text-base-content/70">
              On Hedera a contract can only receive an HTS token after it is associated with it. The vault associates
              itself through the HTS system contract; an existing association counts as success.
            </p>
          </form>
        )}
      </div>
    </Panel>
  );
};
