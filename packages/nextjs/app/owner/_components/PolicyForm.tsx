"use client";

import { type FormEvent, useState } from "react";
import type { VaultWriter } from "./useVaultWriter";
import { formatUnits, parseUnits } from "viem";
import { Panel } from "~~/components/autonr/Panel";
import type { VaultPolicy } from "~~/lib/api/types";

type Field = "maxTradeUsd" | "dailyCapUsd" | "cooldown" | "maxPriceAge" | "maxSlippageBps" | "maxOracleDivergenceBps";
type Draft = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;

const FIELDS: { field: Field; label: string; unit: string; hint: string }[] = [
  { field: "maxTradeUsd", label: "Max per trade", unit: "USD", hint: "More than 0" },
  { field: "dailyCapUsd", label: "Daily cap", unit: "USD", hint: "At least the max per trade" },
  { field: "cooldown", label: "Cooldown", unit: "seconds", hint: "Between two trades" },
  { field: "maxPriceAge", label: "Max price age", unit: "seconds", hint: "60 to 86,400" },
  { field: "maxSlippageBps", label: "Max slippage", unit: "bps", hint: "1 to 5,000" },
  { field: "maxOracleDivergenceBps", label: "Max oracle divergence", unit: "bps", hint: "1 to 5,000" },
];

const UINT32_MAX = 4_294_967_295;

function toDraft(policy: VaultPolicy): Draft {
  return {
    maxTradeUsd: formatUnits(BigInt(policy.maxTradeUsd), 18),
    dailyCapUsd: formatUnits(BigInt(policy.dailyCapUsd), 18),
    cooldown: String(policy.cooldown),
    maxPriceAge: String(policy.maxPriceAge),
    maxSlippageBps: String(policy.maxSlippageBps),
    maxOracleDivergenceBps: String(policy.maxOracleDivergenceBps),
  };
}

function usdE18(value: string): bigint | null {
  return /^\d+(\.\d{1,18})?$/.test(value.trim()) ? parseUnits(value.trim(), 18) : null;
}

function integerIn(value: string, min: number, max: number): number | null {
  const parsed = Number(value.trim());
  return /^\d+$/.test(value.trim()) && parsed >= min && parsed <= max ? parsed : null;
}

/** The same rules as AgentVault.setPolicy, so a bad value is caught before the wallet is asked to sign. */
function validate(draft: Draft) {
  const maxTradeUsd = usdE18(draft.maxTradeUsd);
  const dailyCapUsd = usdE18(draft.dailyCapUsd);
  const cooldown = integerIn(draft.cooldown, 0, UINT32_MAX);
  const maxPriceAge = integerIn(draft.maxPriceAge, 60, 86_400);
  const maxSlippageBps = integerIn(draft.maxSlippageBps, 1, 5_000);
  const maxOracleDivergenceBps = integerIn(draft.maxOracleDivergenceBps, 1, 5_000);

  const errors: Errors = {};
  if (maxTradeUsd === null || maxTradeUsd === 0n) errors.maxTradeUsd = "Enter a USD amount above 0.";
  if (dailyCapUsd === null) errors.dailyCapUsd = "Enter a USD amount.";
  else if (maxTradeUsd !== null && dailyCapUsd < maxTradeUsd)
    errors.dailyCapUsd = "Must be at least the max per trade.";
  if (cooldown === null) errors.cooldown = "Whole seconds.";
  if (maxPriceAge === null) errors.maxPriceAge = "Whole seconds from 60 to 86,400.";
  if (maxSlippageBps === null) errors.maxSlippageBps = "Whole bps from 1 to 5,000.";
  if (maxOracleDivergenceBps === null) errors.maxOracleDivergenceBps = "Whole bps from 1 to 5,000.";

  if (
    Object.keys(errors).length > 0 ||
    maxTradeUsd === null ||
    dailyCapUsd === null ||
    cooldown === null ||
    maxPriceAge === null ||
    maxSlippageBps === null ||
    maxOracleDivergenceBps === null
  ) {
    return { errors, policy: null };
  }
  return {
    errors,
    policy: { maxTradeUsd, dailyCapUsd, cooldown, maxPriceAge, maxSlippageBps, maxOracleDivergenceBps },
  };
}

type PolicyFormProps = { policy: VaultPolicy; canWrite: boolean; writer: VaultWriter };

export const PolicyForm = ({ policy, canWrite, writer }: PolicyFormProps) => {
  const [draft, setDraft] = useState<Draft>(() => toDraft(policy));
  const [submitted, setSubmitted] = useState(false);
  const { errors, policy: next } = validate(draft);
  const visibleErrors = submitted ? errors : {};

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!next) return;
    void writer.send("setPolicy", target =>
      writer.writeContractAsync({ ...target, functionName: "setPolicy", args: [next] }),
    );
  };

  return (
    <Panel
      title="Risk policy"
      description="USD amounts are stored on-chain with 18 decimals. The agent cannot change any of these."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <fieldset disabled={!canWrite} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map(({ field, label, unit, hint }) => (
            <label key={field} className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-base-content/80">
                {label} <span className="font-normal text-base-content/70">({unit})</span>
              </span>
              <input
                inputMode="decimal"
                value={draft[field]}
                onChange={event => setDraft(previous => ({ ...previous, [field]: event.target.value }))}
                aria-invalid={visibleErrors[field] !== undefined}
                className={`input input-sm w-full font-mono tabular-nums ${visibleErrors[field] ? "input-error" : ""}`}
              />
              <span className={visibleErrors[field] ? "font-medium" : "text-base-content/70"}>
                {visibleErrors[field] ?? hint}
              </span>
            </label>
          ))}
        </fieldset>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={writer.pending !== null}>
              {writer.pending === "setPolicy" && <span className="loading loading-spinner loading-xs" aria-hidden />}
              Update policy
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDraft(toDraft(policy));
                setSubmitted(false);
              }}
            >
              Reset to on-chain values
            </button>
          </div>
        )}
      </form>
    </Panel>
  );
};
