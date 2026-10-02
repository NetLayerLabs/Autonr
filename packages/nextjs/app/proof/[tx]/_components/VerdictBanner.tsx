import { consensusTimestampToDate } from "@sh/agent/hedera";
import { CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { ExternalLink } from "~~/components/autonr/ExternalLink";
import { RelativeTime } from "~~/components/autonr/RelativeTime";
import type { CheckStatus, TradeProof } from "~~/lib/api/types";

const VERDICTS = {
  verified: {
    Icon: CheckCircleIcon,
    title: "Verified",
    tone: "border-success/50 bg-success/10",
    icon: "text-success",
    explanation: "Every check passed using public Mirror Node data only.",
  },
  failed: {
    Icon: XCircleIcon,
    title: "Failed",
    tone: "border-error/50 bg-error/10",
    icon: "text-error",
    explanation: "At least one check failed: the trade does not match what the agent published before it.",
  },
  incomplete: {
    Icon: ExclamationTriangleIcon,
    title: "Incomplete",
    tone: "border-warning/60 bg-warning/10",
    icon: "text-warning",
    explanation:
      "Some checks could not run yet, usually because the Mirror Node has not ingested every record. This page re-checks every 10 seconds.",
  },
} as const;

const STATUS_ORDER: CheckStatus[] = ["pass", "warn", "fail", "skip"];

export const VerdictBanner = ({ proof, summary }: { proof: TradeProof; summary: string }) => {
  const verdict = VERDICTS[proof.verdict];
  const counts = STATUS_ORDER.map(status => ({
    status,
    count: proof.checks.filter(check => check.status === status).length,
  })).filter(({ count }) => count > 0);

  return (
    <section aria-label="Verdict" className={`rounded-box border p-4 sm:p-5 ${verdict.tone}`}>
      <div className="flex flex-wrap items-start gap-3">
        <verdict.Icon className={`h-8 w-8 shrink-0 ${verdict.icon}`} aria-hidden />
        <div className="min-w-0 grow">
          <p className="m-0 text-xs uppercase tracking-wider text-base-content/70">
            Trade #{proof.tradeId} on {proof.network}
          </p>
          <h1 className="m-0 mt-1 text-2xl font-bold">{verdict.title}</h1>
          <p className="m-0 mt-1 text-sm">{verdict.explanation}</p>
          <p className="m-0 mt-2 text-sm font-medium">
            {summary} · <RelativeTime date={consensusTimestampToDate(proof.consensusTimestamp)} />
          </p>
          <p className="m-0 mt-2 flex flex-wrap gap-x-3 text-xs text-base-content/80">
            {counts.map(({ status, count }) => (
              <span key={status}>
                <span className="font-semibold tabular-nums">{count}</span> {status}
              </span>
            ))}
          </p>
        </div>
        <nav aria-label="Explorer links" className="flex flex-col gap-1 text-sm">
          <ExternalLink href={proof.links.tx}>Transaction</ExternalLink>
          <ExternalLink href={proof.links.topicMessage}>HCS message #{proof.sequence}</ExternalLink>
          <ExternalLink href={proof.links.vault}>Vault</ExternalLink>
        </nav>
      </div>
    </section>
  );
};
