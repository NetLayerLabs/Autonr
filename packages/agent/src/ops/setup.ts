import { AccountCreateTransaction, Hbar, PrivateKey } from "@hiero-ledger/sdk";
import { type Address, encodeFunctionData, type Hex, isAddressEqual } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { agentVaultAbi } from "../abi/agentVault";
import { readClient, sendContractCall, waitForReceipt, walletClient } from "../chain";
import {
  type AgentCredentials,
  loadAgentCredentials,
  loadOperatorConfig,
  loadOwnDeployment,
  type OperatorConfig,
  scriptCommand,
} from "../config";
import { updateEnvFile } from "../env-file";
import { ecdsaPublicKey, type HederaClient, hederaClient } from "../hcs/client";
import { createDecisionTopic } from "../hcs/topic";
import { entityIdFromNum, entityNum, hashscanUrl } from "../hedera";
import { vaultAccessAbi } from "../vault/abi";

type SetupAction = {
  subject: "agent account" | "decision topic" | "vault agent" | "vault topic";
  outcome: "created" | "updated" | "unchanged" | "skipped";
  detail: string;
  link?: string;
};

type Env = Record<string, string | undefined>;

/** Enough for thousands of HCS messages and hundreds of swaps at current fees. */
const AGENT_INITIAL_HBAR = 25;

/**
 * Prepares an agent for a vault, as the operator (the vault owner). Idempotent: it creates the agent account and the
 * decision topic only when the env file has none, and calls setAgent / setDecisionTopic only when the vault disagrees.
 * New values are written to the env file as soon as they exist, so an interrupted run never loses a key.
 */
export async function runSetup(options: {
  env: Env;
  envFile: string;
  onAction?: (action: SetupAction) => void;
}): Promise<SetupAction[]> {
  const operator = loadOperatorConfig(options.env);
  const existingAgent = loadAgentCredentials(options.env);
  const deployment = loadOwnDeployment(options.env);
  const actions: SetupAction[] = [];
  const report = (action: SetupAction) => {
    actions.push(action);
    options.onAction?.(action);
  };

  const client = hederaClient(operator.network, operator.accountId, operator.privateKey);
  try {
    const agent = existingAgent ?? (await createAgent(client, options.envFile));
    report({
      subject: "agent account",
      outcome: existingAgent ? "unchanged" : "created",
      detail: existingAgent
        ? `${agent.accountId} (EVM ${agent.address})`
        : `${agent.accountId} (EVM ${agent.address}), funded with ${AGENT_INITIAL_HBAR} HBAR by ${operator.accountId}`,
      link: hashscanUrl(operator.network, "account", agent.accountId),
    });

    const topicId = deployment.topicId ?? (await createTopic(client, agent, options.envFile));
    report({
      subject: "decision topic",
      outcome: deployment.topicId ? "unchanged" : "created",
      detail: `${topicId}, submit key = the agent's key`,
      link: hashscanUrl(operator.network, "topic", topicId),
    });

    if (!deployment.vaultAddress) {
      const deploy = scriptCommand("deploy:testnet");
      const detail = `AUTONR_VAULT_ADDRESS is not set; deploy the vault (${deploy}) and run setup again`;
      report({ subject: "vault agent", outcome: "skipped", detail });
      return actions;
    }
    for (const action of await wireVault(operator, deployment.vaultAddress, agent.address, topicId)) report(action);
    return actions;
  } finally {
    client.close();
  }
}

/**
 * An ECDSA account whose EVM address is derived from its key, so the same key signs HCS messages (Hedera SDK) and
 * vault calls (JSON-RPC). Unlimited automatic associations let it receive any token without extra transactions.
 */
async function createAgent(client: HederaClient, envFile: string): Promise<AgentCredentials> {
  const key = PrivateKey.generateECDSA();
  const transaction = new AccountCreateTransaction()
    .setECDSAKeyWithAlias(key.publicKey)
    .setInitialBalance(new Hbar(AGENT_INITIAL_HBAR))
    .setMaxAutomaticTokenAssociations(-1)
    .freezeWith(client);
  // Setting an EVM address alias requires the signature of the key it is derived from.
  const response = await (await transaction.sign(key)).execute(client);
  const { accountId } = await response.getReceipt(client);
  if (!accountId) throw new Error(`account creation ${response.transactionId} returned no account id`);

  const privateKey: Hex = `0x${key.toStringRaw()}`;
  await updateEnvFile(envFile, { AGENT_ACCOUNT_ID: accountId.toString(), AGENT_PRIVATE_KEY: privateKey });
  return { accountId: accountId.toString(), privateKey, address: privateKeyToAddress(privateKey) };
}

async function createTopic(client: HederaClient, agent: AgentCredentials, envFile: string): Promise<string> {
  const topicId = await createDecisionTopic(client, ecdsaPublicKey(agent.privateKey));
  await updateEnvFile(envFile, { AUTONR_TOPIC_ID: topicId });
  return topicId;
}

/** Points the vault at this agent and topic. Only the owner can, so another owner gets the calls to make instead. */
async function wireVault(
  operator: OperatorConfig,
  vault: Address,
  agent: Address,
  topicId: string,
): Promise<SetupAction[]> {
  const client = readClient(operator);
  const [owner, currentAgent, currentTopicNum] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAccessAbi, functionName: "owner" }),
    client.readContract({ address: vault, abi: agentVaultAbi, functionName: "agent" }),
    client.readContract({ address: vault, abi: agentVaultAbi, functionName: "hcsTopicNum" }),
  ]);
  const topicNum = entityNum(topicId);
  const agentOk = isAddressEqual(currentAgent, agent);
  const topicOk = currentTopicNum === topicNum;
  const vaultLink = hashscanUrl(operator.network, "contract", vault);
  const unchangedAgent: SetupAction = {
    subject: "vault agent",
    outcome: "unchanged",
    detail: `vault ${vault} trades through ${agent}`,
    link: vaultLink,
  };
  const unchangedTopic: SetupAction = {
    subject: "vault topic",
    outcome: "unchanged",
    detail: `vault cites decisions from ${topicId}`,
  };
  if (agentOk && topicOk) return [unchangedAgent, unchangedTopic];

  if (!isAddressEqual(owner, operator.address)) {
    const detail =
      `vault ${vault} is owned by ${owner}, not by the operator ${operator.address}; ` +
      `its owner must call setAgent(${agent}) and setDecisionTopic(${topicNum})`;
    return [{ subject: "vault agent", outcome: "skipped", detail, link: vaultLink }];
  }

  const wallet = walletClient(operator, operator.privateKey);
  const send = async (data: Hex): Promise<string> => {
    const txHash = await sendContractCall(client, wallet, { to: vault, data });
    const receipt = await waitForReceipt(client, txHash);
    const link = hashscanUrl(operator.network, "transaction", txHash);
    if (receipt.status !== "success") throw new Error(`transaction ${txHash} reverted: ${link}`);
    return link;
  };
  const actions: SetupAction[] = [];
  if (agentOk) {
    actions.push(unchangedAgent);
  } else {
    const link = await send(encodeFunctionData({ abi: agentVaultAbi, functionName: "setAgent", args: [agent] }));
    actions.push({
      subject: "vault agent",
      outcome: "updated",
      detail: `setAgent(${agent}), was ${currentAgent}`,
      link,
    });
  }
  if (topicOk) {
    actions.push(unchangedTopic);
  } else {
    const link = await send(
      encodeFunctionData({ abi: agentVaultAbi, functionName: "setDecisionTopic", args: [topicNum] }),
    );
    const previous = currentTopicNum === 0n ? "unset" : entityIdFromNum(currentTopicNum);
    actions.push({
      subject: "vault topic",
      outcome: "updated",
      detail: `setDecisionTopic(${topicNum}), was ${previous}`,
      link,
    });
  }
  return actions;
}
