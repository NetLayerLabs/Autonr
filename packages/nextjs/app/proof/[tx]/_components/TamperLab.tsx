"use client";

import { useMemo, useState } from "react";
import { TAMPERINGS } from "./tamperings";
import { evaluateTradeEvidence } from "@sh/agent/evaluate";
import { Panel } from "~~/components/autonr/Panel";
import { CheckStatusBadge, VerdictBadge } from "~~/components/autonr/StatusBadges";
import type { TradeEvidence } from "~~/lib/api/types";

/**
 * Mutates a copy of the trade's evidence and re-runs evaluateTradeEvidence, the verifier the CLI uses, right here in
 * the browser. Each tampering should turn exactly the check that guards against it red.
 */
export const TamperLab = ({ evidence }: { evidence: TradeEvidence }) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const baseline = useMemo(() => evaluateTradeEvidence(evidence), [evidence]);
  const active = TAMPERINGS.find(tampering => tampering.id === activeId) ?? null;
  const tampered = useMemo(() => {
    const mutated = active?.apply(evidence);
    return mutated ? evaluateTradeEvidence(mutated) : null;
  }, [active, evidence]);

  const changed = tampered
    ? tampered.checks.filter((check, index) => check.status !== baseline.checks[index]?.status).map(check => check.id)
    : [];

  return (
    <Panel
      title="Tamper lab"
      description="Change one fact about this trade and watch the verifier catch it. Nothing leaves your browser."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tamperings">
          {TAMPERINGS.map(tampering => {
            const applicable = tampering.apply(evidence) !== null;
            const pressed = tampering.id === activeId;
            return (
              <button
                key={tampering.id}
                type="button"
                aria-pressed={pressed}
                disabled={!applicable}
                title={applicable ? tampering.description : "This evidence lacks what this tampering changes."}
                className={`btn btn-sm ${pressed ? "btn-error" : "btn-outline"}`}
                onClick={() => setActiveId(pressed ? null : tampering.id)}
              >
                {tampering.title}
              </button>
            );
          })}
          {activeId && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActiveId(null)}>
              Reset
            </button>
          )}
        </div>

        <p className="m-0 text-sm" aria-live="polite">
          {active && tampered ? (
            <>
              {active.description} Verdict: <VerdictBadge verdict={baseline.verdict} /> becomes{" "}
              <VerdictBadge verdict={tampered.verdict} />
              {changed.length > 0 ? `, caught by ${changed.join(", ")}.` : ", and no check changed."}
            </>
          ) : (
            "Pick a tampering. The table compares the checks on the real evidence with the checks on the altered copy."
          )}
        </p>

        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Real evidence</th>
                <th scope="col">Tampered copy</th>
              </tr>
            </thead>
            <tbody>
              {baseline.checks.map((check, index) => {
                const after = tampered?.checks[index];
                const flipped = after !== undefined && after.status !== check.status;
                return (
                  <tr key={check.id} className={flipped ? "bg-error/10" : undefined}>
                    <th scope="row" className="font-medium">
                      {check.title}
                      {flipped && <span className="block text-xs font-normal">{after.detail}</span>}
                    </th>
                    <td>
                      <CheckStatusBadge status={check.status} />
                    </td>
                    <td>
                      {after ? (
                        <CheckStatusBadge status={after.status} />
                      ) : (
                        <span className="text-base-content/50">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
};
