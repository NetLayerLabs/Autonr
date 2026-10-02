import { fetchMarketSnapshot, getNetwork, readVaultState } from "@sh/agent";
import "server-only";
import type { MarketResponse, VaultResponse } from "~~/lib/api/types";
import { getReadOnlyConfig } from "~~/lib/server/config";
import { callUpstream } from "~~/lib/server/http";
import { vaultNotConfigured } from "~~/lib/server/not-configured";

/**
 * Chainlink and Supra prices read from the oracle contracts over JSON-RPC, through the feeds the vault is configured
 * with, or the network defaults before there is a vault.
 */
export async function getMarket(): Promise<MarketResponse> {
  const cfg = getReadOnlyConfig();
  const snapshot = await callUpstream(
    `Could not read the Chainlink and Supra feeds on ${cfg.network} (check HEDERA_RPC_URL and your connection)`,
    () => fetchMarketSnapshot(cfg),
  );
  return {
    network: cfg.network,
    snapshot,
    base: cfg.baseToken,
    quote: cfg.quoteToken,
    supra: getNetwork(cfg.network).supra,
  };
}

export async function getVault(): Promise<VaultResponse> {
  const cfg = getReadOnlyConfig();
  if (!cfg.vaultAddress) return vaultNotConfigured(cfg.network);
  const vault = await callUpstream(`Could not read AgentVault ${cfg.vaultAddress} on ${cfg.network}`, () =>
    readVaultState(cfg),
  );
  return vault ? { configured: true, network: cfg.network, vault } : vaultNotConfigured(cfg.network);
}
