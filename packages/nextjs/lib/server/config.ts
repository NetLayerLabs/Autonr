import { type AgentConfig, ConfigError, type ReadOnlyConfig, loadAgentConfig, loadReadOnlyConfig } from "@sh/agent";
import "server-only";

/** Network, endpoints, vault, topic and token settings. Never throws and never holds a private key. */
export function getReadOnlyConfig(): ReadOnlyConfig {
  return loadReadOnlyConfig(process.env);
}

type AgentConfigResult = { ok: true; config: AgentConfig } | { ok: false; missing: string[] };

/**
 * The full agent configuration. It contains the agent's private key, so only the tick route passes `config` on, and
 * only to runTick; everything else reads the non-secret fields.
 */
export function getAgentConfig(): AgentConfigResult {
  try {
    return { ok: true, config: loadAgentConfig(process.env) };
  } catch (error) {
    if (error instanceof ConfigError) return { ok: false, missing: error.missing };
    throw error;
  }
}
