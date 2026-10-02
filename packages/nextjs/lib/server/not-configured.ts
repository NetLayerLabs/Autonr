import type { NetworkName } from "@sh/agent";
import "server-only";
import type { NotConfigured } from "~~/lib/api/types";
import { COMMANDS } from "~~/lib/commands";

const ENV_FILE = "packages/agent/.env";

export function vaultNotConfigured(network: NetworkName): NotConfigured {
  return {
    configured: false,
    reason: `No AgentVault is configured for ${network}. Deploy one, set AUTONR_VAULT_ADDRESS in ${ENV_FILE}, then run setup to create the agent account and its decision topic.`,
    commands: network === "testnet" ? [COMMANDS.deploy, COMMANDS.setup] : [COMMANDS.setup],
  };
}

export function topicNotConfigured(network: NetworkName): NotConfigured {
  return {
    configured: false,
    reason: `No decision topic is configured for ${network}. Setup creates the agent account and its HCS topic and writes AUTONR_TOPIC_ID to ${ENV_FILE}.`,
    commands: [COMMANDS.setup],
  };
}

export function agentNotConfigured(missing: string[]): NotConfigured {
  const what = missing.length > 0 ? missing.join(", ") : "its account and key";
  return {
    configured: false,
    reason: `The agent cannot run until ${what} ${missing.length === 1 ? "is" : "are"} set in ${ENV_FILE}.`,
    commands: [COMMANDS.setup, COMMANDS.doctor],
  };
}

export function agentMismatch(reason: string): NotConfigured {
  return {
    configured: false,
    reason: `The agent's settings do not match the vault: ${reason}.`,
    commands: [COMMANDS.setup, COMMANDS.doctor],
  };
}
