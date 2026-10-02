import "server-only";
import type { AgentStatus, HealthResponse } from "~~/lib/api/types";
import { getAgentConfig, getReadOnlyConfig } from "~~/lib/server/config";

/** Configuration summary for the UI. Reads no network, so it answers even when Hedera is unreachable. */
export function getHealth(): HealthResponse {
  const cfg = getReadOnlyConfig();
  return {
    network: cfg.network,
    vaultAddress: cfg.vaultAddress,
    topicId: cfg.topicId,
    agentAccountId: cfg.agentAccountId,
    agentAddress: cfg.agentAddress,
    baseToken: cfg.baseToken,
    quoteToken: cfg.quoteToken,
    poolFee: cfg.poolFee,
    tickApiEnabled: cfg.tickApiEnabled,
    tickApiSecretRequired: Boolean(process.env.AUTONR_TICK_API_SECRET),
    agent: agentStatus(),
  };
}

function agentStatus(): AgentStatus {
  const agent = getAgentConfig();
  if (!agent.ok) return { ready: false, missing: agent.missing };
  const { strategy, targetBaseWeight, tradeUsd, llm } = agent.config;
  return { ready: true, strategy, targetBaseWeight, tradeUsd, llmModel: llm?.model ?? null };
}
