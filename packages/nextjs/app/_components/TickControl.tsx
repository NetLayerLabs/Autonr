"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { hashscanTopicMessageUrl } from "@sh/agent/hedera";
import type { NetworkName } from "@sh/agent/networks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import { EmptyState } from "~~/components/autonr/EmptyState";
import { ExternalLink } from "~~/components/autonr/ExternalLink";
import { ErrorNotice } from "~~/components/autonr/QueryBoundary";
import { DecisionKindBadge } from "~~/components/autonr/StatusBadges";
import { AUTONR_QUERY_KEY } from "~~/hooks/autonr/useAutonrApi";
import { postJson } from "~~/lib/api/client";
import type { TickRequest, TickResponse, TickResult } from "~~/lib/api/types";

type Mode = "strategy" | "buy" | "sell";

/** Runs one agent tick through POST /api/agent/tick; dry runs publish and send nothing. */
export const TickControl = ({ network, requiresSecret }: { network: NetworkName; requiresSecret: boolean }) => {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("strategy");
  const [usd, setUsd] = useState("5");
  const [dryRun, setDryRun] = useState(true);
  const [secret, setSecret] = useState("");

  const tick = useMutation({
    mutationFn: (request: TickRequest) =>
      postJson<TickResponse>("/api/agent/tick", request, requiresSecret ? { "x-autonr-secret": secret } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [AUTONR_QUERY_KEY] }),
  });

  const amount = Number(usd);
  const manualInvalid = mode !== "strategy" && !(Number.isFinite(amount) && amount > 0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    tick.mutate(mode === "strategy" ? { dryRun } : { dryRun, manual: { side: mode, usd: amount } });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-base-300 pt-4">
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <legend className="mb-2 text-sm font-medium">Run one tick</legend>
        {(["strategy", "buy", "sell"] as const).map(option => (
          <label key={option} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="tick-mode"
              className="radio radio-xs radio-primary"
              checked={mode === option}
              onChange={() => setMode(option)}
            />
            {option === "strategy" ? "Strategy decides" : `Manual ${option}`}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        {mode !== "strategy" && (
          <label className="flex flex-col gap-1 text-xs">
            Amount (USD)
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={usd}
              onChange={event => setUsd(event.target.value)}
              aria-invalid={manualInvalid}
              className={`input input-sm w-28 tabular-nums ${manualInvalid ? "input-error" : ""}`}
            />
          </label>
        )}
        {requiresSecret && (
          <label className="flex flex-col gap-1 text-xs">
            Tick API secret
            <input
              type="password"
              value={secret}
              onChange={event => setSecret(event.target.value)}
              autoComplete="off"
              className="input input-sm w-44"
            />
          </label>
        )}
        <label className="flex cursor-pointer items-center gap-2 pb-1 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            checked={dryRun}
            onChange={event => setDryRun(event.target.checked)}
          />
          Dry run
        </label>
        <button type="submit" className="btn btn-primary btn-sm" disabled={tick.isPending || manualInvalid}>
          {tick.isPending && <span className="loading loading-spinner loading-xs" aria-hidden />}
          {tick.isPending ? "Running" : dryRun ? "Simulate tick" : "Run tick"}
        </button>
      </div>
      {!requiresSecret && (
        <p className="m-0 flex items-start gap-1.5 text-xs text-base-content/70">
          <ExclamationTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          No AUTONR_TICK_API_SECRET is set, so ticks run only from localhost on the development server (yarn start).
        </p>
      )}
      {tick.isError && <ErrorNotice message={tick.error.message} />}
      {tick.data &&
        (tick.data.configured ? (
          <TickOutcome result={tick.data.result} network={network} />
        ) : (
          <EmptyState reason={tick.data.reason} commands={tick.data.commands} />
        ))}
    </form>
  );
};

const TickOutcome = ({ result, network }: { result: TickResult; network: NetworkName }) => {
  const { kind, decision, hcs, trade, rejection, dryRun, durationMs } = result;
  return (
    <div className="flex flex-col gap-2 rounded-box bg-base-200 p-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <DecisionKindBadge kind={kind} />
        {dryRun && <span className="badge badge-outline badge-sm">dry run</span>}
        <span className="text-xs tabular-nums text-base-content/70">{(durationMs / 1000).toFixed(1)} s</span>
      </div>
      <p className="m-0">{decision.rationale}</p>
      {rejection && (
        <p className="m-0 text-xs">
          Refused at {rejection.stage}: <span className="font-mono font-semibold">{rejection.error}</span>
          {rejection.detail && <> · {rejection.detail}</>}
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {hcs && (
          <ExternalLink href={hashscanTopicMessageUrl(network, hcs.topicId, hcs.sequence)}>
            HCS message #{hcs.sequence}
          </ExternalLink>
        )}
        {trade && (
          <>
            <Link href={`/proof/${trade.txHash}`} className="link font-medium">
              Verify trade #{trade.tradeId}
            </Link>
            <ExternalLink href={trade.hashscanUrl}>Transaction</ExternalLink>
          </>
        )}
      </div>
    </div>
  );
};
