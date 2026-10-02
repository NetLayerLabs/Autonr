"use client";

import { useEffect } from "react";
import { consensusTimestampToDate, hashscanTopicMessageUrl, hashscanUrl } from "@sh/agent/hedera";
import type { NetworkName } from "@sh/agent/networks";
import { useMutation } from "@tanstack/react-query";
import { CommandLine } from "~~/components/autonr/CommandLine";
import { EmptyState } from "~~/components/autonr/EmptyState";
import { ExternalLink } from "~~/components/autonr/ExternalLink";
import { Panel } from "~~/components/autonr/Panel";
import { ErrorNotice, QueryBoundary } from "~~/components/autonr/QueryBoundary";
import { RelativeTime } from "~~/components/autonr/RelativeTime";
import { useDecisions } from "~~/hooks/autonr/useAutonrApi";
import { getJson } from "~~/lib/api/client";
import type { DecisionEntry, DecisionRecord, Rejection, ReplayResponse, ReplayResult } from "~~/lib/api/types";
import { replayCommand } from "~~/lib/commands";

type RejectedEntry = DecisionEntry & { record: DecisionRecord & { rejection: Rejection } };

/** Every refusal in the decision log; simulation refusals can be re-executed at their historical block. */
export const RejectionsPanel = () => {
  const decisions = useDecisions(100);
  const loaded = decisions.data !== undefined;

  // Rows render after the data arrives, so a #decision-<seq> link from the decision log needs a late scroll.
  useEffect(() => {
    if (!loaded || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [loaded]);

  return (
    <Panel
      title="Rejections"
      description="A refusal records the block and caller of the refused call. Replay re-executes that call through the Mirror Node at the same block and checks that the vault returns the same custom error."
    >
      <QueryBoundary query={decisions} skeletonLines={4}>
        {data => {
          if (!data.configured) return <EmptyState reason={data.reason} commands={data.commands} />;
          const rejected = data.decisions.filter(isRejected);
          if (rejected.length === 0) {
            return (
              <p className="m-0 text-sm text-base-content/80">
                No rejections in the last {data.decisions.length} messages. The playground shows what one looks like.
              </p>
            );
          }
          return (
            <ol className="m-0 list-none divide-y divide-base-300 p-0">
              {rejected.map(entry => (
                <RejectionRow key={entry.sequence} entry={entry} network={data.network} topicId={data.topicId} />
              ))}
            </ol>
          );
        }}
      </QueryBoundary>
    </Panel>
  );
};

function isRejected(entry: DecisionEntry): entry is RejectedEntry {
  return entry.record?.kind === "rejected" && entry.record.rejection !== undefined;
}

type RejectionRowProps = { entry: RejectedEntry; network: NetworkName; topicId: string };

const RejectionRow = ({ entry, network, topicId }: RejectionRowProps) => {
  const { stage, error, detail, replay, txHash } = entry.record.rejection;
  return (
    <li id={`decision-${entry.sequence}`} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 target:bg-primary/5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <ExternalLink
          href={hashscanTopicMessageUrl(network, topicId, entry.sequence)}
          className="font-mono font-semibold"
        >
          #{entry.sequence}
        </ExternalLink>
        <span className="font-mono font-semibold">{error}</span>
        <span className="badge badge-ghost badge-sm">{stage}</span>
        <span className="text-xs text-base-content/70">
          <RelativeTime date={consensusTimestampToDate(entry.consensusTimestamp)} />
        </span>
      </div>
      {detail && <p className="m-0 text-sm text-base-content/80">{detail}</p>}
      {replay ? (
        <ReplayControl sequence={entry.sequence} block={replay.block} />
      ) : txHash ? (
        <ExternalLink href={hashscanUrl(network, "transaction", txHash)} className="w-fit text-xs">
          The reverted transaction
        </ExternalLink>
      ) : (
        <p className="m-0 text-xs text-base-content/70">This record carries no replay data.</p>
      )}
    </li>
  );
};

const ReplayControl = ({ sequence, block }: { sequence: number; block: number }) => {
  const replay = useMutation({ mutationFn: () => getJson<ReplayResponse>(`/api/replay/${sequence}`) });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={() => replay.mutate()} disabled={replay.isPending}>
          {replay.isPending && <span className="loading loading-spinner loading-xs" aria-hidden />}
          Replay at block {block.toLocaleString("en-US")}
        </button>
        <details className="text-xs">
          <summary className="cursor-pointer text-base-content/70">From a terminal</summary>
          <div className="mt-2 max-w-md">
            <CommandLine command={replayCommand(sequence)} />
          </div>
        </details>
      </div>
      {replay.isError && <ErrorNotice message={replay.error.message} />}
      {replay.data &&
        (replay.data.configured ? (
          <ReplayOutcome result={replay.data.result} />
        ) : (
          <EmptyState reason={replay.data.reason} commands={replay.data.commands} />
        ))}
    </div>
  );
};

const ReplayOutcome = ({ result }: { result: ReplayResult }) => (
  <div className="flex flex-col gap-1 rounded-box bg-base-200 p-3 text-sm" aria-live="polite">
    <p className="m-0 flex flex-wrap items-center gap-2">
      <span className={`badge badge-sm ${result.reproduced ? "badge-success" : "badge-error"}`}>
        {result.reproduced ? "reproduced" : "not reproduced"}
      </span>
      <span>
        Recorded <span className="font-mono font-semibold">{result.expectedError}</span>, replay returned{" "}
        <span className="font-mono font-semibold">{result.replayedError ?? "no error"}</span>
      </span>
    </p>
    {result.detail && <p className="m-0 text-xs text-base-content/80">{result.detail}</p>}
  </div>
);
