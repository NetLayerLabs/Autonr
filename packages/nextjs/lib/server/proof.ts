import { isTxHash, mirrorTransactionId } from "@sh/agent/hedera";
import { type NetworkName, isNetworkName } from "@sh/agent/networks";
import { buildTradeProof, fetchTradeEvidence } from "@sh/agent/verify";
import "server-only";
import type { ProofResponse } from "~~/lib/api/types";
import { getReadOnlyConfig } from "~~/lib/server/config";
import { callUpstream } from "~~/lib/server/http";

export const TX_FORMAT_HINT =
  "Expected an EVM transaction hash (0x followed by 64 hex characters) or a Hedera transaction id such as 0.0.1234@1727800000.123456789.";

export function parseTx(raw: string): string | null {
  let tx: string;
  try {
    tx = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  return isTxHash(tx) || mirrorTransactionId(tx) !== null ? tx : null;
}

/** The dashboard's own network unless the caller names another, so a trade on either network can be checked. */
export function parseNetwork(raw: string | null): NetworkName | null {
  if (raw === null) return getReadOnlyConfig().network;
  return isNetworkName(raw) ? raw : null;
}

/** The proof plus the evidence behind it, so the browser can re-run the same checks on a tampered copy. */
export async function getProof(tx: string, network: NetworkName): Promise<ProofResponse> {
  const cfg = getReadOnlyConfig();
  const mirrorUrl = network === cfg.network ? cfg.mirrorUrl : undefined;
  const evidence = await callUpstream(`Could not gather the evidence for ${tx} on ${network}`, () =>
    fetchTradeEvidence({ network, tx, mirrorUrl }),
  );
  return { proof: buildTradeProof(evidence), evidence };
}
