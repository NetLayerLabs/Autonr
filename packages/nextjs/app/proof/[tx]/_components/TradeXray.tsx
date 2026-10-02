import { type CallRole, contractNames, describeCall, isSaucerSwapEntry } from "./callLabels";
import { Panel } from "~~/components/autonr/Panel";
import type { TradeEvidence } from "~~/lib/api/types";
import { shortHex } from "~~/lib/format";

const ROLE_STYLES: Record<CallRole, string> = {
  oracle: "border-l-2 border-info bg-info/10",
  swap: "border-l-2 border-primary bg-primary/10",
  vault: "font-semibold",
  token: "",
  other: "text-base-content/70",
};

const ROLE_BADGES: Partial<Record<CallRole, string>> = { oracle: "oracle read", swap: "swap" };

const MAX_INDENT = 6;

/**
 * The call tree of the trade transaction from the Mirror Node's actions endpoint. It shows, inside one atomic
 * transaction, the vault reading every oracle before SaucerSwap swaps: prices cannot change between check and swap.
 */
export const TradeXray = ({ evidence }: { evidence: TradeEvidence }) => {
  const { trace } = evidence;
  if (trace === null || trace.length === 0) {
    return (
      <Panel title="Trade X-ray" description="The call tree inside the trade transaction.">
        <p className="m-0 text-sm">The Mirror Node returned no call trace for this transaction yet.</p>
      </Panel>
    );
  }

  const names = contractNames(evidence.network, evidence.vault);
  if (evidence.from) names.set(evidence.from.toLowerCase(), "Agent");
  const name = (address: string) => names.get(address.toLowerCase()) ?? shortHex(address);
  const vault = evidence.vault.toLowerCase();
  // Numbered from 0 like the Mirror Node's action index, which the atomic-trace check's evidence also uses.
  const calls = trace.map((call, index) => ({
    ...call,
    index,
    fn: describeCall(call.selector),
    // Like the atomic-trace check, only the vault's own calls count; proxies forwarding to implementations do not.
    byVault: call.caller.toLowerCase() === vault,
  }));
  const swap = calls.find(call => call.byVault && isSaucerSwapEntry(call.selector));
  const reads = calls.filter(call => call.byVault && call.fn.role === "oracle");

  return (
    <Panel
      title="Trade X-ray"
      description={summarize(
        reads.map(read => read.index),
        swap?.index,
      )}
    >
      <ol className="m-0 flex list-none flex-col gap-0.5 overflow-x-auto p-0 font-mono text-xs">
        {calls.map(call => (
          <li
            key={call.index}
            className={`flex min-w-max items-center gap-2 rounded-sm px-2 py-1 ${ROLE_STYLES[call.fn.role]}`}
            style={{ paddingLeft: `${0.5 + Math.min(call.depth, MAX_INDENT) * 1.25}rem` }}
          >
            <span className="w-6 shrink-0 text-right tabular-nums text-base-content/60">{call.index}</span>
            <span>
              {name(call.caller)} <span aria-label="calls">→</span> {name(call.to)}
            </span>
            <span className="font-semibold">{call.fn.label}</span>
            {call.byVault && ROLE_BADGES[call.fn.role] && (
              <span className="badge badge-outline badge-xs">{ROLE_BADGES[call.fn.role]}</span>
            )}
            {!call.resultOk && <span className="badge badge-error badge-xs">reverted</span>}
          </li>
        ))}
      </ol>
    </Panel>
  );
};

function summarize(reads: number[], swap: number | undefined): string {
  if (swap === undefined) return "The vault made no SaucerSwap exactInput call in this transaction.";
  if (reads.length === 0) return `The vault swapped at call ${swap} without reading an oracle first.`;
  const order = reads.every(read => read < swap) ? "then" : "but not all before it,";
  return `The vault read its oracles at calls ${reads.join(", ")}, ${order} swapped on SaucerSwap at call ${swap}, all inside one transaction.`;
}
