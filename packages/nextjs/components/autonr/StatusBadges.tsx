import {
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  NoSymbolIcon,
  PauseCircleIcon,
  QuestionMarkCircleIcon,
  XCircleIcon,
} from "@heroicons/react/16/solid";
import type { CheckStatus, DecisionKind, TradeProof } from "~~/lib/api/types";

type BadgeStyle = { className: string; Icon: typeof CheckCircleIcon; label: string };

// Every badge pairs its color with an icon and a word, so state never depends on color alone.
const DECISION_STYLES: Record<DecisionKind | "invalid", BadgeStyle> = {
  trade: { className: "badge-primary", Icon: ArrowsRightLeftIcon, label: "trade" },
  hold: { className: "badge-ghost", Icon: PauseCircleIcon, label: "hold" },
  rejected: { className: "badge-error", Icon: NoSymbolIcon, label: "rejected" },
  invalid: { className: "badge-warning", Icon: QuestionMarkCircleIcon, label: "invalid" },
};

const CHECK_STYLES: Record<CheckStatus, BadgeStyle> = {
  pass: { className: "badge-success", Icon: CheckCircleIcon, label: "pass" },
  fail: { className: "badge-error", Icon: XCircleIcon, label: "fail" },
  warn: { className: "badge-warning", Icon: ExclamationTriangleIcon, label: "warn" },
  skip: { className: "badge-ghost", Icon: MinusCircleIcon, label: "skip" },
};

const VERDICT_STYLES: Record<TradeProof["verdict"], BadgeStyle> = {
  verified: { className: "badge-success", Icon: CheckCircleIcon, label: "verified" },
  failed: { className: "badge-error", Icon: XCircleIcon, label: "failed" },
  incomplete: { className: "badge-warning", Icon: ExclamationTriangleIcon, label: "incomplete" },
};

const Badge = ({ style: { className, Icon, label } }: { style: BadgeStyle }) => (
  <span className={`badge badge-sm gap-1 whitespace-nowrap font-medium ${className}`}>
    <Icon className="h-3.5 w-3.5" aria-hidden />
    {label}
  </span>
);

export const DecisionKindBadge = ({ kind }: { kind: DecisionKind | "invalid" }) => (
  <Badge style={DECISION_STYLES[kind]} />
);

export const CheckStatusBadge = ({ status }: { status: CheckStatus }) => <Badge style={CHECK_STYLES[status]} />;

export const VerdictBadge = ({ verdict }: { verdict: TradeProof["verdict"] }) => (
  <Badge style={VERDICT_STYLES[verdict]} />
);
