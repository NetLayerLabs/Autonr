"use client";

import { useState } from "react";
import { CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from "@heroicons/react/16/solid";
import { EmptyState } from "~~/components/autonr/EmptyState";
import { ErrorNotice } from "~~/components/autonr/QueryBoundary";
import { useHealth } from "~~/hooks/autonr/useAutonrApi";
import { postJson } from "~~/lib/api/client";
import type { RedTeamResponse, RedTeamResult, RedTeamScenario } from "~~/lib/api/types";
import { COMMANDS } from "~~/lib/commands";

type Run = { status: "running" } | { status: "done"; response: RedTeamResponse } | { status: "error"; message: string };

/** One card per rule. Each run is an eth_call against the live vault: nothing is signed or sent. */
export const GuardrailPlayground = ({ scenarios }: { scenarios: readonly RedTeamScenario[] }) => {
  const health = useHealth();
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const vaultConfigured = Boolean(health.data?.vaultAddress);
  const busy = Object.values(runs).some(run => run.status === "running");

  const run = async (id: RedTeamScenario["id"]) => {
    setRuns(previous => ({ ...previous, [id]: { status: "running" } }));
    try {
      const response = await postJson<RedTeamResponse>("/api/red-team", { id });
      setRuns(previous => ({ ...previous, [id]: { status: "done", response } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuns(previous => ({ ...previous, [id]: { status: "error", message } }));
    }
  };

  const runAll = async () => {
    for (const scenario of scenarios) await run(scenario.id);
  };

  return (
    <div className="flex flex-col gap-4">
      {health.data && !vaultConfigured && (
        <div className="rounded-box border border-base-300 bg-base-100 p-4">
          <EmptyState
            reason={`The playground calls a deployed AgentVault on ${health.data.network}, and none is configured. Deploy one, set AUTONR_VAULT_ADDRESS in packages/agent/.env, then run setup.`}
            commands={[COMMANDS.deploy, COMMANDS.setup]}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void runAll()}
          disabled={!vaultConfigured || busy}
        >
          Run all {scenarios.length}
        </button>
        <span className="text-xs text-base-content/70">
          From a terminal: <code>{COMMANDS.redTeam}</code>
        </span>
      </div>
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">
        {scenarios.map(scenario => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            run={runs[scenario.id]}
            disabled={!vaultConfigured || runs[scenario.id]?.status === "running"}
            onRun={() => void run(scenario.id)}
          />
        ))}
      </ul>
    </div>
  );
};

type ScenarioCardProps = { scenario: RedTeamScenario; run: Run | undefined; disabled: boolean; onRun: () => void };

const ScenarioCard = ({ scenario, run, disabled, onRun }: ScenarioCardProps) => (
  <li className="flex flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4">
    <div>
      <h2 className="m-0 text-sm font-semibold">{scenario.title}</h2>
      <p className="m-0 mt-1 text-sm text-base-content/80">{scenario.rule}</p>
    </div>
    <p className="m-0 text-xs text-base-content/70">
      Expected: <span className="font-mono font-semibold text-base-content">{scenario.expectedError}</span>
    </p>
    <button type="button" className="btn btn-sm w-fit" onClick={onRun} disabled={disabled}>
      {run?.status === "running" && <span className="loading loading-spinner loading-xs" aria-hidden />}
      Try it on the vault
    </button>
    <div aria-live="polite">
      {run?.status === "error" && <ErrorNotice message={run.message} />}
      {run?.status === "done" &&
        (run.response.configured ? (
          <ScenarioOutcome result={run.response.result} />
        ) : (
          <EmptyState reason={run.response.reason} commands={run.response.commands} />
        ))}
    </div>
  </li>
);

const ScenarioOutcome = ({ result }: { result: RedTeamResult }) => {
  const verdict = !result.rejected
    ? { className: "badge-error", Icon: XCircleIcon, text: "not refused" }
    : result.matchedExpectation
      ? { className: "badge-success", Icon: CheckCircleIcon, text: "refused as expected" }
      : result.error === "CooldownActive"
        ? {
            className: "badge-warning",
            Icon: ExclamationTriangleIcon,
            text: "refused first by the cooldown; retry after it",
          }
        : { className: "badge-warning", Icon: ExclamationTriangleIcon, text: "refused, different error" };
  const params = Object.entries(result.request);

  return (
    <div className="flex flex-col gap-2 rounded-box bg-base-200 p-3 text-sm">
      <p className="m-0 flex flex-wrap items-center gap-2">
        <span className={`badge badge-sm gap-1 ${verdict.className}`}>
          <verdict.Icon className="h-3.5 w-3.5" aria-hidden />
          {verdict.text}
        </span>
        {result.rejected && <span className="font-mono font-semibold">{result.error}</span>}
      </p>
      {result.detail && <p className="m-0 text-xs text-base-content/80">{result.detail}</p>}
      {params.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-base-content/70">Simulated call</summary>
          <dl className="m-0 mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            {params.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-base-content/70">{key}</dt>
                <dd className="m-0 break-all font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
};
