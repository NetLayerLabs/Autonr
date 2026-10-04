"use client";

import Link from "next/link";
import { hashscanUrl } from "@sh/agent/hedera";
import type { NetworkName } from "@sh/agent/networks";
import { formatUnits } from "viem";
import { EmptyState } from "~~/components/autonr/EmptyState";
import { EntityId } from "~~/components/autonr/EntityId";
import { Meter } from "~~/components/autonr/Meter";
import { Panel } from "~~/components/autonr/Panel";
import { QueryBoundary } from "~~/components/autonr/QueryBoundary";
import { RelativeTime } from "~~/components/autonr/RelativeTime";
import { useHealth, useMarket, useVault } from "~~/hooks/autonr/useAutonrApi";
import { useNow } from "~~/hooks/autonr/useNow";
import type { MarketSnapshot, VaultState } from "~~/lib/api/types";
import { COMMANDS } from "~~/lib/commands";
import { e18ToNumber, formatBps, formatDuration, formatPercent, formatTokenAmount, formatUsd } from "~~/lib/format";

const DAY_MS = 86_400_000;

export const VaultPanel = () => {
  const vault = useVault();
  const paused = vault.data?.configured ? vault.data.vault.paused : null;

  return (
    <Panel
      title="Vault"
      description="AgentVault state, policy and limits as the contract reports them."
      actions={paused !== null && <PausedBadge paused={paused} />}
    >
      <QueryBoundary query={vault} skeletonLines={8}>
        {data =>
          data.configured ? (
            <VaultDetails network={data.network} vault={data.vault} />
          ) : (
            <EmptyState reason={data.reason} commands={data.commands} />
          )
        }
      </QueryBoundary>
    </Panel>
  );
};

const PausedBadge = ({ paused }: { paused: boolean }) =>
  paused ? (
    <span className="badge badge-error badge-sm">paused</span>
  ) : (
    <span className="badge badge-success badge-sm">active</span>
  );

const VaultDetails = ({ network, vault }: { network: NetworkName; vault: VaultState }) => {
  const snapshot = useMarket().data?.snapshot ?? null;
  const health = useHealth().data;
  const targetWeight = health?.agent.ready ? health.agent.targetBaseWeight : null;
  const holdings = vault.tokens.map(token => {
    const price = priceOf(snapshot, token.address);
    const amount = Number(formatUnits(BigInt(token.balance), token.decimals));
    return { ...token, usd: price === null ? null : amount * price };
  });
  const totalUsd = holdings.every(holding => holding.usd !== null)
    ? holdings.reduce((sum, holding) => sum + (holding.usd ?? 0), 0)
    : null;
  const base = health ? holdings.find(holding => sameAddress(holding.address, health.baseToken.address)) : undefined;
  const baseWeight = base && base.usd !== null && totalUsd ? base.usd / totalUsd : null;
  const empty = holdings.every(holding => BigInt(holding.balance) === 0n);

  return (
    <div className="flex flex-col gap-5">
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-base-content/70">Address</dt>
        <dd className="m-0 min-w-0">
          <EntityId value={vault.address} href={hashscanUrl(network, "contract", vault.address)} short />
        </dd>
        <dt className="text-base-content/70">Owner</dt>
        <dd className="m-0 min-w-0">
          <EntityId value={vault.owner} href={hashscanUrl(network, "account", vault.owner)} short />
        </dd>
        <dt className="text-base-content/70">Agent</dt>
        <dd className="m-0 min-w-0">
          <EntityId value={vault.agent} href={hashscanUrl(network, "account", vault.agent)} short />
        </dd>
        <dt className="text-base-content/70">Decision topic</dt>
        <dd className="m-0 min-w-0">
          {vault.topicId ? (
            <EntityId value={vault.topicId} href={hashscanUrl(network, "topic", vault.topicId)} />
          ) : (
            <span className="text-xs">
              not set: trading is disabled until the owner sets it (run <code>{COMMANDS.setup}</code>)
            </span>
          )}
        </dd>
      </dl>

      {vault.tokens.length === 0 ? (
        <p className="m-0 text-sm">
          No tokens are configured. The owner adds them on the{" "}
          <Link href="/owner" className="link font-medium">
            Owner
          </Link>{" "}
          page.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="table table-xs">
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col" className="text-right">
                    Balance
                  </th>
                  <th scope="col" className="text-right">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {holdings.map(holding => (
                  <tr key={holding.address}>
                    <td className="font-medium">{holding.symbol}</td>
                    <td className="text-right font-mono tabular-nums">
                      {formatTokenAmount(holding.balance, holding.decimals)}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {holding.usd === null ? "-" : formatUsd(holding.usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {totalUsd !== null && (
                <tfoot>
                  <tr>
                    <th scope="row">Total</th>
                    <td />
                    <td className="text-right font-mono tabular-nums">{formatUsd(totalUsd)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {empty ? (
            <EmptyState
              reason="The vault holds no tokens yet. Wrap testnet HBAR into WHBAR and send it to the vault:"
              commands={[COMMANDS.fund]}
            />
          ) : (
            baseWeight !== null &&
            health && (
              <WeightBar
                baseSymbol={health.baseToken.symbol}
                quoteSymbol={health.quoteToken.symbol}
                weight={baseWeight}
                target={targetWeight}
              />
            )
          )}
        </div>
      )}

      <Limits vault={vault} />
    </div>
  );
};

const Limits = ({ vault }: { vault: VaultState }) => {
  const now = useNow(1_000);
  const { policy } = vault;
  const cap = e18ToNumber(policy.dailyCapUsd);
  const spent = e18ToNumber(vault.spentTodayUsd);
  const resetIn = (Math.floor(now / DAY_MS) + 1) * DAY_MS - now;
  const cooldownLeft = vault.nextTradeAt * 1000 - now;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Meter
          label="Spent today (UTC)"
          value={spent}
          limit={cap}
          valueText={formatUsd(spent)}
          limitText={`cap ${formatUsd(cap)}`}
        />
        <p className="m-0 text-xs text-base-content/70">
          {formatUsd(e18ToNumber(vault.remainingDailyUsd))} left · resets at 00:00 UTC, in{" "}
          <span className="tabular-nums">{formatDuration(resetIn / 1000)}</span>
        </p>
      </div>

      <div className="flex flex-col gap-0.5 text-sm">
        <p className="m-0">
          {vault.paused ? (
            "Paused: the vault refuses every trade until the owner unpauses it."
          ) : cooldownLeft > 0 ? (
            <>
              Cooldown: the next trade is allowed in{" "}
              <span className="font-semibold tabular-nums">{formatDuration(cooldownLeft / 1000)}</span>.
            </>
          ) : (
            "Ready: no cooldown in effect."
          )}
        </p>
        <p className="m-0 text-xs text-base-content/70">
          {vault.lastTradeAt > 0 ? (
            <>
              Last trade <RelativeTime date={new Date(vault.lastTradeAt * 1000)} />
            </>
          ) : (
            "No trades yet"
          )}
        </p>
      </div>

      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <PolicyItem label="Max per trade" value={formatUsd(e18ToNumber(policy.maxTradeUsd))} />
        <PolicyItem label="Daily cap" value={formatUsd(cap)} />
        <PolicyItem label="Cooldown" value={formatDuration(policy.cooldown)} />
        <PolicyItem label="Max price age" value={formatDuration(policy.maxPriceAge)} />
        <PolicyItem label="Max slippage" value={formatBps(policy.maxSlippageBps)} />
        <PolicyItem label="Max divergence" value={formatBps(policy.maxOracleDivergenceBps)} />
        <PolicyItem label="Trades executed" value={vault.tradeCount.toLocaleString("en-US")} />
        <PolicyItem label="Last reasoning seq" value={`#${vault.lastReasoningSequence}`} />
      </dl>
    </div>
  );
};

const PolicyItem = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <dt className="text-xs text-base-content/70">{label}</dt>
    <dd className="m-0 font-semibold">{value}</dd>
  </div>
);

type WeightBarProps = { baseSymbol: string; quoteSymbol: string; weight: number; target: number | null };

/** Share of the vault's USD value held in the base token, against the strategy's target. */
const WeightBar = ({ baseSymbol, quoteSymbol, weight, target }: WeightBarProps) => {
  const description = `${baseSymbol} is ${formatPercent(weight)} of the vault value${
    target === null ? "" : `, target ${formatPercent(target, 0)}`
  }`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-base-content/70">{baseSymbol} share of value</span>
        <span className="tabular-nums">
          <span className="font-semibold">{formatPercent(weight)}</span>
          {target !== null && <span className="text-base-content/60"> / target {formatPercent(target, 0)}</span>}
        </span>
      </div>
      <svg role="img" aria-label={description} width="100%" height="8" className="block overflow-visible">
        <rect width="100%" height="8" rx="4" className="fill-base-300" />
        <rect width={`${Math.min(100, weight * 100)}%`} height="8" rx="4" className="fill-primary" />
        {target !== null && (
          <line
            x1={`${target * 100}%`}
            x2={`${target * 100}%`}
            y1="-3"
            y2="11"
            strokeWidth="2"
            className="stroke-base-content"
          />
        )}
      </svg>
      <div className="flex justify-between text-xs text-base-content/70">
        <span>{baseSymbol}</span>
        <span>{quoteSymbol}</span>
      </div>
    </div>
  );
};

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function priceOf(snapshot: MarketSnapshot | null, token: string): number | null {
  if (!snapshot) return null;
  const oracle = [snapshot.base, snapshot.quote].find(candidate => sameAddress(candidate.token, token));
  return oracle?.priceUsd ?? null;
}
