import { compareConsensusTimestamps, consensusDeltaMs, consensusTimestampToDate } from "@sh/agent/hedera";
import { Panel } from "~~/components/autonr/Panel";
import type { TradeProof } from "~~/lib/api/types";
import { formatDuration, formatUtc } from "~~/lib/format";

function formatGap(ms: number): string {
  const abs = Math.abs(ms);
  return abs < 60_000 ? `${(abs / 1000).toFixed(3)} s` : formatDuration(abs / 1000);
}

const Moment = ({ label, timestamp, detail }: { label: string; timestamp: string; detail: string }) => (
  <li className="relative pl-6">
    <span className="absolute left-0 top-1 h-3 w-3 rounded-full bg-primary ring-4 ring-base-100" aria-hidden />
    <p className="m-0 text-sm font-medium">{label}</p>
    <p className="m-0 text-xs text-base-content/70">{detail}</p>
    <p className="m-0 mt-0.5 font-mono text-xs">
      {formatUtc(consensusTimestampToDate(timestamp))} <span className="text-base-content/60">({timestamp})</span>
    </p>
  </li>
);

/** Consensus order of the decision message and the trade. Hedera timestamps are compared to the nanosecond. */
export const DecisionTimeline = ({ proof }: { proof: TradeProof }) => {
  const published = proof.messageConsensusTimestamp;

  return (
    <Panel title="Timeline" description="Hedera orders both events by consensus timestamp, to the nanosecond.">
      {published === null ? (
        <p className="m-0 text-sm">
          No message was found at sequence #{proof.sequence} of topic {proof.topicId}, so the order cannot be checked
          yet.
        </p>
      ) : (
        <ol className="relative m-0 flex list-none flex-col gap-4 p-0 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-0.5 before:bg-base-300">
          <Moment
            label="Decision published to HCS"
            timestamp={published}
            detail={`Topic ${proof.topicId}, message #${proof.sequence}`}
          />
          <li className="pl-6 text-xs">
            <Gap published={published} executed={proof.consensusTimestamp} />
          </li>
          <Moment
            label="Trade executed by the vault"
            timestamp={proof.consensusTimestamp}
            detail={`Trade #${proof.tradeId}`}
          />
        </ol>
      )}
    </Panel>
  );
};

const Gap = ({ published, executed }: { published: string; executed: string }) => {
  const gap = formatGap(consensusDeltaMs(published, executed));
  return compareConsensusTimestamps(published, executed) < 0 ? (
    <span className="badge badge-ghost badge-sm tabular-nums">published {gap} before the trade</span>
  ) : (
    <span className="badge badge-error badge-sm tabular-nums">published {gap} after the trade</span>
  );
};
