"use client";

import Link from "next/link";
import { hashscanTopicMessageUrl, hashscanUrl } from "@sh/agent/hedera";
import { ArrowPathIcon, CheckCircleIcon, XCircleIcon } from "@heroicons/react/20/solid";
import { EmptyState } from "~~/components/autonr/EmptyState";
import { ExternalLink } from "~~/components/autonr/ExternalLink";
import { Panel } from "~~/components/autonr/Panel";
import { QueryBoundary } from "~~/components/autonr/QueryBoundary";
import { useAudit } from "~~/hooks/autonr/useAutonrApi";
import type { AuditReport } from "~~/lib/api/types";
import { e18ToNumber, formatUsd } from "~~/lib/format";

export const AuditReportPanel = () => {
  const audit = useAudit();
  return (
    <Panel
      title="Gapless audit"
      description="Every TradeExecuted event must cite exactly one earlier trade record by sequence and hash, every trade record must end in a trade or an execution-stage rejection, and every message must be paid by the agent."
      actions={
        <button type="button" className="btn btn-sm" onClick={() => void audit.refetch()} disabled={audit.isFetching}>
          <ArrowPathIcon className={`h-4 w-4 ${audit.isFetching ? "animate-spin" : ""}`} aria-hidden />
          Re-run
        </button>
      }
    >
      <QueryBoundary query={audit} skeletonLines={6}>
        {data =>
          data.configured ? (
            <AuditReportView report={data.report} />
          ) : (
            <EmptyState reason={data.reason} commands={data.commands} />
          )
        }
      </QueryBoundary>
    </Panel>
  );
};

const AuditReportView = ({ report }: { report: AuditReport }) => {
  const { decisions } = report;
  const tiles = [
    { label: "Trade events", value: report.trades },
    { label: "Matched to a record", value: report.matchedTrades },
    { label: "Trade records", value: decisions.trade },
    { label: "Holds", value: decisions.hold },
    { label: "Rejections", value: decisions.rejected },
    { label: "Invalid messages", value: decisions.invalid },
    { label: "Foreign payer", value: decisions.foreignPayer },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div
        role="status"
        className={`flex items-start gap-2 rounded-box border p-3 text-sm ${
          report.ok ? "border-success/50 bg-success/10" : "border-error/50 bg-error/10"
        }`}
      >
        {report.ok ? (
          <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
        ) : (
          <XCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-error" aria-hidden />
        )}
        <p className="m-0">
          <span className="font-semibold">{report.ok ? "No gaps." : "Gaps found."}</span> Messages #
          {report.fromSequence} to #{report.toSequence} of topic{" "}
          <ExternalLink href={hashscanUrl(report.network, "topic", report.topicId)} className="font-mono">
            {report.topicId}
          </ExternalLink>{" "}
          checked against the trades of the vault.
        </p>
      </div>

      <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map(tile => (
          <div key={tile.label} className="rounded-box bg-base-200 px-3 py-2">
            <dt className="text-xs text-base-content/70">{tile.label}</dt>
            <dd className="m-0 text-xl font-semibold">{tile.value.toLocaleString("en-US")}</dd>
          </div>
        ))}
      </dl>

      {report.findings.length > 0 && (
        <section aria-label="Findings">
          <h3 className="m-0 mb-2 text-sm font-semibold">Findings</h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {report.findings.map(finding => (
              <li key={`${finding.severity}-${finding.message}`} className="flex items-start gap-2 text-sm">
                <span className={`badge badge-sm ${finding.severity === "error" ? "badge-error" : "badge-warning"}`}>
                  {finding.severity}
                </span>
                <span className="min-w-0 break-words">{finding.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.unmatchedTrades.length > 0 && (
        <section aria-label="Trades without a matching decision">
          <h3 className="m-0 mb-2 text-sm font-semibold">Trades without a matching decision record</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {report.unmatchedTrades.map(trade => (
              <li key={trade.txHash} className="flex flex-wrap items-center gap-x-3">
                <span className="font-mono">#{trade.tradeId}</span>
                <span className="tabular-nums">{formatUsd(e18ToNumber(trade.usdValue))}</span>
                <span className="text-base-content/70">cites HCS #{trade.hcsSequence}</span>
                <Link href={`/proof/${trade.txHash}`} className="link font-medium">
                  Inspect the proof
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.tradeRecordsWithoutOutcome.length > 0 && (
        <section aria-label="Trade records without an outcome">
          <h3 className="m-0 mb-2 text-sm font-semibold">Trade records with no trade and no rejection</h3>
          <p className="m-0 flex flex-wrap gap-2 text-sm">
            {report.tradeRecordsWithoutOutcome.map(sequence => (
              <ExternalLink
                key={sequence}
                href={hashscanTopicMessageUrl(report.network, report.topicId, sequence)}
                className="font-mono"
              >
                #{sequence}
              </ExternalLink>
            ))}
          </p>
        </section>
      )}
    </div>
  );
};
