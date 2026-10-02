import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getJson, shouldRetry } from "~~/lib/api/client";
import type {
  AuditResponse,
  DecisionsResponse,
  HealthResponse,
  MarketResponse,
  ProofResponse,
  TradesResponse,
  VaultResponse,
} from "~~/lib/api/types";

/** Oracle feeds and the vault change every few seconds on Hedera; ten seconds keeps the console current. */
const POLL_INTERVAL_MS = 10_000;

/** Every dashboard query key starts with this, so an agent tick can refresh them all at once. */
export const AUTONR_QUERY_KEY = "autonr";

const live = { refetchInterval: POLL_INTERVAL_MS, retry: shouldRetry, placeholderData: keepPreviousData } as const;

export const useHealth = () =>
  useQuery({
    queryKey: [AUTONR_QUERY_KEY, "health"],
    queryFn: () => getJson<HealthResponse>("/api/health"),
    // Configuration only changes when the server restarts.
    staleTime: Infinity,
    retry: shouldRetry,
  });

export const useMarket = () =>
  useQuery({ queryKey: [AUTONR_QUERY_KEY, "market"], queryFn: () => getJson<MarketResponse>("/api/market"), ...live });

export const useVault = () =>
  useQuery({ queryKey: [AUTONR_QUERY_KEY, "vault"], queryFn: () => getJson<VaultResponse>("/api/vault"), ...live });

export const useDecisions = (limit: number) =>
  useQuery({
    queryKey: [AUTONR_QUERY_KEY, "decisions", limit],
    queryFn: () => getJson<DecisionsResponse>(`/api/decisions?limit=${limit}`),
    ...live,
  });

export const useTrades = (limit: number) =>
  useQuery({
    queryKey: [AUTONR_QUERY_KEY, "trades", limit],
    queryFn: () => getJson<TradesResponse>(`/api/trades?limit=${limit}`),
    ...live,
  });

/** The audit walks the whole decision log, so it runs on demand instead of polling. */
export const useAudit = () =>
  useQuery({
    queryKey: [AUTONR_QUERY_KEY, "audit"],
    queryFn: () => getJson<AuditResponse>("/api/audit"),
    retry: shouldRetry,
    refetchOnWindowFocus: false,
  });

/** Re-verifies while the verdict is incomplete: that only means the Mirror Node has not ingested everything yet. */
export const useProof = (tx: string, network: string | null) =>
  useQuery({
    queryKey: [AUTONR_QUERY_KEY, "proof", tx, network],
    queryFn: () =>
      getJson<ProofResponse>(
        `/api/proof/${encodeURIComponent(tx)}${network ? `?network=${encodeURIComponent(network)}` : ""}`,
      ),
    retry: shouldRetry,
    refetchInterval: query => (query.state.data?.proof.verdict === "incomplete" ? POLL_INTERVAL_MS : false),
  });
