import { RED_TEAM_SCENARIOS, type RedTeamScenarioId, isRedTeamScenarioId, runRedTeam } from "@sh/agent";
import "server-only";
import type { RedTeamResponse } from "~~/lib/api/types";
import { getReadOnlyConfig } from "~~/lib/server/config";
import { callUpstream } from "~~/lib/server/http";
import { vaultNotConfigured } from "~~/lib/server/not-configured";

export { RED_TEAM_SCENARIOS, isRedTeamScenarioId };

export const RED_TEAM_REQUEST_SHAPE = `Expected a JSON body { "id": "${RED_TEAM_SCENARIOS.map(scenario => scenario.id).join('" | "')}" }.`;

/** Simulates one rule-breaking executeSwap with eth_call: nothing is signed or sent, so it costs no HBAR. */
export async function runScenario(id: RedTeamScenarioId): Promise<RedTeamResponse> {
  const cfg = getReadOnlyConfig();
  if (!cfg.vaultAddress) return vaultNotConfigured(cfg.network);
  const result = await callUpstream(`Could not simulate "${id}" against AgentVault ${cfg.vaultAddress}`, () =>
    runRedTeam(cfg, id),
  );
  return { configured: true, result };
}
