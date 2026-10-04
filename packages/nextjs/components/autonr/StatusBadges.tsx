import type { CheckStatus, DecisionKind, TradeProof } from "~~/lib/api/types";

type BadgeStyle = { className: string; label: string };

// Every badge carries a word as well as a tone, so state never depends on color alone.
const DECISION_STYLES: Record<DecisionKind | "invalid", BadgeStyle> = {
  trade: { className: "badge-neutral", label: "trade" },
  hold: { className: "badge-ghost", label: "hold" },
  rejected: { className: "badge-error", label: "rejected" },
  invalid: { className: "badge-warning", label: "invalid" },
};

const CHECK_STYLES: Record<CheckStatus, BadgeStyle> = {
  pass: { className: "badge-success", label: "pass" },
  fail: { className: "badge-error", label: "fail" },
  warn: { className: "badge-warning", label: "warn" },
  skip: { className: "badge-ghost", label: "skip" },
};

const VERDICT_STYLES: Record<TradeProof["verdict"], BadgeStyle> = {
  verified: { className: "badge-success", label: "verified" },
  failed: { className: "badge-error", label: "failed" },
  incomplete: { className: "badge-warning", label: "incomplete" },
};

const Badge = ({ style: { className, label } }: { style: BadgeStyle }) => (
  <span className={`badge badge-sm ${className}`}>{label}</span>
);

export const DecisionKindBadge = ({ kind }: { kind: DecisionKind | "invalid" }) => (
  <Badge style={DECISION_STYLES[kind]} />
);

export const CheckStatusBadge = ({ status }: { status: CheckStatus }) => <Badge style={CHECK_STYLES[status]} />;

export const VerdictBadge = ({ verdict }: { verdict: TradeProof["verdict"] }) => (
  <Badge style={VERDICT_STYLES[verdict]} />
);
