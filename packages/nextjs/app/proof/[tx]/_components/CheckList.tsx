import { CheckStatusBadge } from "~~/components/autonr/StatusBadges";
import type { VerificationCheck } from "~~/lib/api/types";

/** The verifier's checks in order, each with the evidence it compared. */
export const CheckList = ({ checks }: { checks: VerificationCheck[] }) => (
  <ol className="m-0 flex list-none flex-col divide-y divide-base-300 p-0">
    {checks.map(check => (
      <li key={check.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-center gap-2">
          <CheckStatusBadge status={check.status} />
          <span className="text-sm font-medium">{check.title}</span>
          <code className="text-xs text-base-content/60">{check.id}</code>
        </div>
        <p className="m-0 break-words text-sm text-base-content/80">{check.detail}</p>
        {check.evidence && Object.keys(check.evidence).length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-base-content/70">Evidence</summary>
            <dl className="m-0 mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              {Object.entries(check.evidence).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-base-content/70">{key}</dt>
                  <dd className="m-0 break-all font-mono">{value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </li>
    ))}
  </ol>
);
