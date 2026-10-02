import { auditDecisionLog, listDecisions, listTrades, replayRejection } from "@sh/agent/verify";
import "server-only";
import type { AuditResponse, DecisionsResponse, ReplayResponse, TradesResponse } from "~~/lib/api/types";
import { getReadOnlyConfig } from "~~/lib/server/config";
import { callUpstream } from "~~/lib/server/http";
import { topicNotConfigured, vaultNotConfigured } from "~~/lib/server/not-configured";

// History comes from the Mirror Node, never eth_getLogs: the JSON-RPC relay rejects log queries spanning more than
// seven days, and the Mirror Node is the same public source an independent verifier would use.

export async function getDecisions(limit: number): Promise<DecisionsResponse> {
  const { network, topicId, mirrorUrl } = getReadOnlyConfig();
  if (!topicId) return topicNotConfigured(network);
  const decisions = await callUpstream(`Could not read decision topic ${topicId} from the ${network} Mirror Node`, () =>
    listDecisions({ network, topicId, limit, mirrorUrl }),
  );
  return { configured: true, network, topicId, decisions };
}

export async function getTrades(limit: number): Promise<TradesResponse> {
  const { network, vaultAddress: vault, mirrorUrl } = getReadOnlyConfig();
  if (!vault) return vaultNotConfigured(network);
  const trades = await callUpstream(
    `Could not read the trades of AgentVault ${vault} from the ${network} Mirror Node`,
    () => listTrades({ network, vault, limit, mirrorUrl }),
  );
  return { configured: true, network, vault, trades };
}

export async function getAudit(limit: number): Promise<AuditResponse> {
  const { network, vaultAddress: vault, topicId, mirrorUrl } = getReadOnlyConfig();
  if (!vault) return vaultNotConfigured(network);
  if (!topicId) return topicNotConfigured(network);
  const report = await callUpstream(`Could not audit decision topic ${topicId} against AgentVault ${vault}`, () =>
    auditDecisionLog({ network, vault, topicId, limit, mirrorUrl }),
  );
  return { configured: true, report };
}

export async function getReplay(sequence: number): Promise<ReplayResponse> {
  const { network, topicId, mirrorUrl } = getReadOnlyConfig();
  if (!topicId) return topicNotConfigured(network);
  const result = await callUpstream(`Could not replay decision #${sequence} of topic ${topicId}`, () =>
    replayRejection({ network, topicId, sequence, mirrorUrl }),
  );
  return { configured: true, result };
}
