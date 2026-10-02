"use client";

import { TickControl } from "./TickControl";
import { hashscanUrl } from "@sh/agent/hedera";
import { NETWORKS } from "@sh/agent/networks";
import { CommandLine } from "~~/components/autonr/CommandLine";
import { EmptyState } from "~~/components/autonr/EmptyState";
import { EntityId } from "~~/components/autonr/EntityId";
import { Panel } from "~~/components/autonr/Panel";
import { QueryBoundary } from "~~/components/autonr/QueryBoundary";
import { useHealth } from "~~/hooks/autonr/useAutonrApi";
import type { HealthResponse } from "~~/lib/api/types";
import { COMMANDS } from "~~/lib/commands";
import { formatPercent, formatUsd } from "~~/lib/format";

/** What this dashboard is connected to, and how to run the agent. */
export const AgentPanel = () => {
  const health = useHealth();
  const reference = health.data ? isReferenceDeployment(health.data) : false;
  return (
    <Panel
      title="Deployment"
      description={
        reference
          ? "The Autonr reference deployment on testnet, shown read-only until you configure your own."
          : "Read from packages/agent/.env on the server."
      }
      className="shadow-lg"
    >
      <QueryBoundary query={health} skeletonLines={6}>
        {data => (
          <div className="flex flex-col gap-4">
            <DeploymentFacts health={data} />
            <TickSection health={data} />
          </div>
        )}
      </QueryBoundary>
    </Panel>
  );
};

/** True when no vault of your own is configured, so the dashboard falls back to the built-in reference deployment. */
const isReferenceDeployment = ({ network, vaultAddress, agent }: HealthResponse) =>
  !agent.ready &&
  vaultAddress !== null &&
  NETWORKS[network].reference?.vault.toLowerCase() === vaultAddress.toLowerCase();

const NotSet = ({ name }: { name: string }) => (
  <span className="text-xs text-base-content/70">
    not set (<code>{name}</code>)
  </span>
);

const DeploymentFacts = ({ health }: { health: HealthResponse }) => {
  const { network, vaultAddress, topicId, agentAccountId, agentAddress, baseToken, quoteToken, poolFee, agent } =
    health;
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-sm">
      <dt className="text-base-content/70">Network</dt>
      <dd className="m-0">
        <span className="badge badge-outline badge-sm">{network}</span>
      </dd>
      <dt className="text-base-content/70">Vault</dt>
      <dd className="m-0 min-w-0">
        {vaultAddress ? (
          <EntityId value={vaultAddress} href={hashscanUrl(network, "contract", vaultAddress)} short />
        ) : (
          <NotSet name="AUTONR_VAULT_ADDRESS" />
        )}
      </dd>
      <dt className="text-base-content/70">Decision topic</dt>
      <dd className="m-0 min-w-0">
        {topicId ? (
          <EntityId value={topicId} href={hashscanUrl(network, "topic", topicId)} />
        ) : (
          <NotSet name="AUTONR_TOPIC_ID" />
        )}
      </dd>
      <dt className="text-base-content/70">Agent</dt>
      <dd className="m-0 min-w-0">
        {agentAccountId ? (
          <EntityId value={agentAccountId} href={hashscanUrl(network, "account", agentAccountId)} />
        ) : agentAddress ? (
          <EntityId value={agentAddress} href={hashscanUrl(network, "account", agentAddress)} short />
        ) : (
          <NotSet name="AGENT_ACCOUNT_ID" />
        )}
      </dd>
      <dt className="text-base-content/70">Pair</dt>
      <dd className="m-0">
        {baseToken.symbol} / {quoteToken.symbol}
        <span className="text-base-content/70"> · SaucerSwap V2 fee {formatPercent(poolFee / 1_000_000, 2)}</span>
      </dd>
      <dt className="text-base-content/70">Strategy</dt>
      <dd className="m-0">
        {agent.ready ? (
          <>
            {agent.strategy}
            {agent.llmModel && <span className="text-base-content/70"> ({agent.llmModel})</span>}
            <span className="text-base-content/70">
              {" "}
              · target {formatPercent(agent.targetBaseWeight, 0)} {baseToken.symbol}, up to {formatUsd(agent.tradeUsd)}{" "}
              per trade
            </span>
          </>
        ) : (
          <span className="text-xs text-base-content/70">
            {isReferenceDeployment(health) ? "rebalance (reference agent)" : "the agent is not configured yet"}
          </span>
        )}
      </dd>
    </dl>
  );
};

const TickSection = ({ health }: { health: HealthResponse }) => {
  const { agent, tickApiEnabled, tickApiSecretRequired, network, vaultAddress } = health;
  if (!agent.ready) {
    const needsDeploy = vaultAddress === null && network === "testnet";
    if (isReferenceDeployment(health)) {
      return (
        <div className="border-t border-base-300 pt-4">
          <EmptyState
            reason="You are looking at the reference vault: browse its decisions and trades, verify any trade, or run the guardrail playground against it. To run an agent of your own, deploy a vault and set it up."
            commands={[COMMANDS.deploy, COMMANDS.setup]}
          />
        </div>
      );
    }
    return (
      <div className="border-t border-base-300 pt-4">
        <EmptyState
          reason={`The agent runs once ${agent.missing.join(", ") || "its account and key"} ${
            agent.missing.length === 1 ? "is" : "are"
          } set in packages/agent/.env. Setup creates the agent account and its decision topic.`}
          commands={needsDeploy ? [COMMANDS.deploy, COMMANDS.setup] : [COMMANDS.setup, COMMANDS.doctor]}
        />
      </div>
    );
  }
  if (!tickApiEnabled) {
    return (
      <div className="flex flex-col gap-2 border-t border-base-300 pt-4">
        <p className="m-0 text-sm font-medium">Run the agent from a terminal</p>
        <CommandLine command={COMMANDS.dryRun} />
        <CommandLine command={COMMANDS.tick} />
        <CommandLine command={COMMANDS.loop} />
        <p className="m-0 text-xs text-base-content/70">
          To run ticks from this page, set <code>AUTONR_ENABLE_TICK_API=true</code> in packages/agent/.env and restart
          the dashboard. Without <code>AUTONR_TICK_API_SECRET</code> the page only runs ticks on localhost under{" "}
          <code>yarn start</code>.
        </p>
      </div>
    );
  }
  return <TickControl network={network} requiresSecret={tickApiSecretRequired} />;
};
