"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { consensusTimestampToDate, hashscanTopicMessageUrl, hashscanUrl } from "@sh/agent/hedera";
import type { NetworkName } from "@sh/agent/networks";
import { EmptyState } from "~~/components/autonr/EmptyState";
import { ExternalLink } from "~~/components/autonr/ExternalLink";
import { Panel } from "~~/components/autonr/Panel";
import { QueryBoundary } from "~~/components/autonr/QueryBoundary";
import { RelativeTime } from "~~/components/autonr/RelativeTime";
import { DecisionKindBadge } from "~~/components/autonr/StatusBadges";
import { useDecisions, useHealth, useTrades } from "~~/hooks/autonr/useAutonrApi";
import { type TokenInfo, useTokenDirectory } from "~~/hooks/autonr/useTokenDirectory";
import type { DecisionEntry, DecisionRecord } from "~~/lib/api/types";
import { COMMANDS } from "~~/lib/commands";
import { formatTokenAmount, formatUsd } from "~~/lib/format";

const PAGE_SIZES = [25, 100] as const;

/** The agent's HCS topic, newest first: every trade, hold and rejection it published. */
export const DecisionLog = () => {
  const [limit, setLimit] = useState<(typeof PAGE_SIZES)[number]>(PAGE_SIZES[0]);
  const decisions = useDecisions(limit);
  // A window of N messages holds at most N trade records, so N trades always cover the trades they cite.
  const trades = useTrades(limit);
  const agentAccountId = useHealth().data?.agentAccountId ?? null;
  const token = useTokenDirectory();

  // A trade record and the vault's TradeExecuted event share the HCS sequence number.
  const tradeTxBySequence = useMemo(() => {
    const bySequence = new Map<number, string>();
    if (trades.data?.configured) {
      for (const trade of trades.data.trades) bySequence.set(trade.hcsSequence, trade.txHash);
    }
    return bySequence;
  }, [trades.data]);

  return (
    <Panel
      title="Decision log"
      description="Published to HCS before any trade. The vault only executes a trade that cites one of these messages."
      actions={
        <select
          className="select select-xs w-auto"
          value={limit}
          onChange={event => setLimit(PAGE_SIZES.find(size => size === Number(event.target.value)) ?? PAGE_SIZES[0])}
          aria-label="Number of decisions to show"
        >
          {PAGE_SIZES.map(size => (
            <option key={size} value={size}>
              Last {size}
            </option>
          ))}
        </select>
      }
    >
      <QueryBoundary query={decisions} skeletonLines={6}>
        {data =>
          !data.configured ? (
            <EmptyState reason={data.reason} commands={data.commands} />
          ) : data.decisions.length === 0 ? (
            <EmptyState
              reason={`Topic ${data.topicId} has no messages yet. A dry run shows what the agent would decide without publishing; a tick publishes it.`}
              commands={[COMMANDS.dryRun, COMMANDS.tick]}
            />
          ) : (
            <ol className="m-0 list-none divide-y divide-base-300 p-0">
              {data.decisions.map(entry => (
                <DecisionRow
                  key={entry.sequence}
                  entry={entry}
                  network={data.network}
                  topicId={data.topicId}
                  agentAccountId={agentAccountId}
                  tradeTx={tradeTxBySequence.get(entry.sequence) ?? null}
                  token={token}
                />
              ))}
            </ol>
          )
        }
      </QueryBoundary>
    </Panel>
  );
};

type DecisionRowProps = {
  entry: DecisionEntry;
  network: NetworkName;
  topicId: string;
  agentAccountId: string | null;
  tradeTx: string | null;
  token: (address: string) => TokenInfo | null;
};

const DecisionRow = ({ entry, network, topicId, agentAccountId, tradeTx, token }: DecisionRowProps) => {
  const { record } = entry;
  const title = record ? headline(record, token) : "Not a valid decision record";
  const foreignPayer = agentAccountId !== null && entry.payer !== agentAccountId;

  return (
    <li className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-0.5 text-xs">
        <ExternalLink
          href={hashscanTopicMessageUrl(network, topicId, entry.sequence)}
          className="font-mono font-semibold"
        >
          #{entry.sequence}
        </ExternalLink>
        <RelativeTime date={consensusTimestampToDate(entry.consensusTimestamp)} />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionKindBadge kind={record?.kind ?? "invalid"} />
          {title && <span className="text-sm font-medium">{title}</span>}
          {foreignPayer && (
            <span className="badge badge-warning badge-sm" title={`Expected payer ${agentAccountId}`}>
              paid by {entry.payer}
            </span>
          )}
        </div>
        {record ? (
          <>
            <p className="m-0 text-sm text-base-content/80">{record.rationale}</p>
            <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/70">
              <span>
                {record.strategy.id} {record.strategy.version}
                {record.strategy.model && ` (${record.strategy.model})`}
              </span>
              {record.market.map(observation => (
                <span key={`${observation.source}-${observation.feed}`} className="tabular-nums">
                  {observation.feed} {observation.price} ({observation.source}
                  {observation.divergenceBps !== undefined && `, ${observation.divergenceBps} bps vs Supra`})
                </span>
              ))}
              <span>payer {entry.payer}</span>
            </p>
            <DecisionLinks record={record} network={network} sequence={entry.sequence} tradeTx={tradeTx} />
          </>
        ) : (
          <InvalidMessage error={entry.error} raw={entry.raw} />
        )}
      </div>
    </li>
  );
};

const RAW_PREVIEW_LENGTH = 300;

/** Invalid messages are reported, never hidden; the details stay folded so they do not crowd the log. */
const InvalidMessage = ({ error, raw }: { error: string | null; raw: string }) => (
  <details className="text-xs">
    <summary className="cursor-pointer text-base-content/80">Why it is invalid, and the raw message</summary>
    <div className="mt-2 flex flex-col gap-2">
      {error && <pre className="m-0 max-h-48 overflow-auto rounded-box bg-base-200 p-2">{error}</pre>}
      <p className="m-0 break-all font-mono text-base-content/70">
        {raw.length > RAW_PREVIEW_LENGTH ? `${raw.slice(0, RAW_PREVIEW_LENGTH)}…` : raw}
      </p>
    </div>
  </details>
);

type DecisionLinksProps = { record: DecisionRecord; network: NetworkName; sequence: number; tradeTx: string | null };

const DecisionLinks = ({ record, network, sequence, tradeTx }: DecisionLinksProps) => {
  if (record.kind === "trade") {
    return tradeTx ? (
      <Link href={`/proof/${tradeTx}`} className="link w-fit text-xs font-medium">
        Verify the trade
      </Link>
    ) : (
      <span className="text-xs text-base-content/70">No TradeExecuted event cites this message yet.</span>
    );
  }
  if (record.kind === "rejected" && record.rejection?.replay) {
    return (
      <Link href={`/audit#decision-${sequence}`} className="link w-fit text-xs font-medium">
        Replay the refusal at block {record.rejection.replay.block}
      </Link>
    );
  }
  if (record.kind === "rejected" && record.rejection?.txHash) {
    return (
      <ExternalLink href={hashscanUrl(network, "transaction", record.rejection.txHash)} className="w-fit text-xs">
        Reverted transaction
      </ExternalLink>
    );
  }
  return null;
};

/** One line on what the record decided; a hold needs none beyond its badge and rationale. */
function headline(record: DecisionRecord, token: (address: string) => TokenInfo | null): string | null {
  if (record.kind === "hold") return null;
  if (record.kind === "rejected" && record.rejection) {
    const { error, stage, detail } = record.rejection;
    return `Refused by the vault (${stage}): ${error}${detail ? `, ${detail}` : ""}`;
  }
  if (!record.action) return record.kind;
  const { side, tokenIn, tokenOut, amountIn, usd } = record.action;
  const sold = token(tokenIn);
  const bought = token(tokenOut);
  const amount = sold ? `${formatTokenAmount(amountIn, sold.decimals)} ${sold.symbol}` : `${amountIn} units`;
  return `${side === "sell" ? "Sell" : "Buy"}: ${amount} for ${bought?.symbol ?? tokenOut}, about ${formatUsd(Number(usd))}`;
}
