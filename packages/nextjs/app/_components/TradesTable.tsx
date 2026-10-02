"use client";

import Link from "next/link";
import { consensusTimestampToDate, hashscanTopicMessageUrl, hashscanUrl } from "@sh/agent/hedera";
import type { NetworkName } from "@sh/agent/networks";
import { EmptyState } from "~~/components/autonr/EmptyState";
import { ExternalLink } from "~~/components/autonr/ExternalLink";
import { Panel } from "~~/components/autonr/Panel";
import { QueryBoundary } from "~~/components/autonr/QueryBoundary";
import { RelativeTime } from "~~/components/autonr/RelativeTime";
import { useHealth, useTrades } from "~~/hooks/autonr/useAutonrApi";
import { type TokenInfo, useTokenDirectory } from "~~/hooks/autonr/useTokenDirectory";
import type { TradeSummary } from "~~/lib/api/types";
import { COMMANDS } from "~~/lib/commands";
import { e18ToNumber, formatTokenAmount, formatUsd } from "~~/lib/format";

/** TradeExecuted events of the vault, from the Mirror Node. Each one links to its independent proof. */
export const TradesTable = () => {
  const trades = useTrades(25);
  const topicId = useHealth().data?.topicId ?? null;
  const token = useTokenDirectory();

  return (
    <Panel
      title="Trades"
      description="Every swap the vault executed. Verify re-checks one from public Mirror Node data, the same way the CLI does."
    >
      <QueryBoundary query={trades} skeletonLines={4}>
        {data =>
          !data.configured ? (
            <EmptyState reason={data.reason} commands={data.commands} />
          ) : data.trades.length === 0 ? (
            <EmptyState
              reason="The vault has not traded yet. The agent trades when the vault drifts from its target weight and the pool price clears the vault's oracle minimum."
              commands={[COMMANDS.dryRun]}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th scope="col">Trade</th>
                    <th scope="col">When</th>
                    <th scope="col" className="text-right">
                      Sold
                    </th>
                    <th scope="col" className="text-right">
                      Bought
                    </th>
                    <th scope="col" className="text-right">
                      Value
                    </th>
                    <th scope="col" className="text-right">
                      Above minimum
                    </th>
                    <th scope="col">Decision</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.trades.map(trade => (
                    <TradeRow key={trade.txHash} trade={trade} network={data.network} topicId={topicId} token={token} />
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryBoundary>
    </Panel>
  );
};

type TradeRowProps = {
  trade: TradeSummary;
  network: NetworkName;
  topicId: string | null;
  token: (address: string) => TokenInfo | null;
};

const TradeRow = ({ trade, network, topicId, token }: TradeRowProps) => {
  const sold = token(trade.tokenIn);
  const bought = token(trade.tokenOut);
  const minimum = BigInt(trade.minAmountOut);
  // How much better than the vault's oracle-derived floor the pool paid, in basis points of that floor.
  const headroomBps = minimum > 0n ? Number(((BigInt(trade.amountOut) - minimum) * 10_000n) / minimum) : null;

  return (
    <tr>
      <td className="font-mono">#{trade.tradeId}</td>
      <td>
        <RelativeTime date={consensusTimestampToDate(trade.consensusTimestamp)} />
      </td>
      <td className="whitespace-nowrap text-right font-mono tabular-nums">
        <Amount raw={trade.amountIn} token={sold} />
      </td>
      <td className="whitespace-nowrap text-right font-mono tabular-nums">
        <Amount raw={trade.amountOut} token={bought} />
      </td>
      <td className="text-right font-mono tabular-nums">{formatUsd(e18ToNumber(trade.usdValue))}</td>
      <td className="text-right font-mono tabular-nums">
        {headroomBps === null ? "-" : `${(headroomBps / 100).toFixed(2)}%`}
      </td>
      <td>
        {topicId ? (
          <ExternalLink href={hashscanTopicMessageUrl(network, topicId, trade.hcsSequence)} className="font-mono">
            #{trade.hcsSequence}
          </ExternalLink>
        ) : (
          <span className="font-mono">#{trade.hcsSequence}</span>
        )}
      </td>
      <td>
        <div className="flex items-center justify-end gap-3">
          <Link href={`/proof/${trade.txHash}`} className="btn btn-primary btn-xs">
            Verify
          </Link>
          <ExternalLink href={hashscanUrl(network, "transaction", trade.txHash)} className="text-xs">
            HashScan
          </ExternalLink>
        </div>
      </td>
    </tr>
  );
};

const Amount = ({ raw, token }: { raw: string; token: TokenInfo | null }) =>
  token ? (
    <>
      {formatTokenAmount(raw, token.decimals)} <span className="text-base-content/70">{token.symbol}</span>
    </>
  ) : (
    <span title="Unknown token: raw amount">{raw}</span>
  );
