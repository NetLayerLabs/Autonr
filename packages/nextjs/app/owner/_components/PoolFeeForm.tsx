"use client";

import { type FormEvent, useState } from "react";
import type { VaultWriter } from "./useVaultWriter";
import { Panel } from "~~/components/autonr/Panel";
import { useHealth } from "~~/hooks/autonr/useAutonrApi";
import type { VaultToken } from "~~/lib/api/types";
import { formatPercent } from "~~/lib/format";

type PoolFeeFormProps = { tokens: VaultToken[]; poolFee: number; canWrite: boolean; writer: VaultWriter };

/** SaucerSwap V2 fee tiers, in hundredths of a basis point. */
const FEE_TIERS = [500, 1500, 3000, 10_000];
/** The router reads the fee as a uint24 from the swap path. */
const UINT24_MAX = 16_777_215;

/** `poolFee` is the tier approved for the configured base/quote pair, the one the agent trades. */
export const PoolFeeForm = ({ tokens, poolFee, canWrite, writer }: PoolFeeFormProps) => {
  const health = useHealth().data;
  const [tokenA, setTokenA] = useState<string>(tokens[0]?.address ?? "");
  const [tokenB, setTokenB] = useState<string>(tokens[1]?.address ?? "");
  const [fee, setFee] = useState(String(poolFee || 3000));

  const feeInput = fee.trim();
  const feeValue = /^\d+$/.test(feeInput) && Number(feeInput) <= UINT24_MAX ? Number(feeInput) : null;
  const a = tokens.find(token => token.address === tokenA);
  const b = tokens.find(token => token.address === tokenB);
  const ready = a !== undefined && b !== undefined && a.address !== b.address && feeValue !== null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || feeValue === null) return;
    void writer.send("setPoolFee", target =>
      writer.writeContractAsync({ ...target, functionName: "setPoolFee", args: [a.address, b.address, feeValue] }),
    );
  };

  const pair = health && `${health.baseToken.symbol}/${health.quoteToken.symbol}`;
  const current = pair
    ? poolFee === 0
      ? `No fee tier is approved for ${pair}, so the vault refuses every trade between them.`
      : `${pair} trades in the ${formatPercent(poolFee / 1_000_000, 2)} pool (fee ${poolFee}).`
    : null;

  return (
    <Panel
      title="Pool fee tier"
      description="The agent can only swap through the SaucerSwap V2 pool whose fee tier you approved for the pair. 0 disallows the pair."
    >
      <div className="flex flex-col gap-3">
        {current && <p className="m-0 text-sm">{current}</p>}
        {tokens.length < 2 && <p className="m-0 text-sm">Configure two tokens before approving a fee tier.</p>}
        {canWrite && tokens.length >= 2 && (
          <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
            {[
              { label: "Token A", value: tokenA, set: setTokenA },
              { label: "Token B", value: tokenB, set: setTokenB },
            ].map(({ label, value, set }) => (
              <label key={label} className="flex flex-col gap-1 text-xs">
                {label}
                <select value={value} onChange={event => set(event.target.value)} className="select select-sm">
                  {tokens.map(option => (
                    <option key={option.address} value={option.address}>
                      {option.symbol}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="flex flex-col gap-1 text-xs">
              Fee (hundredths of a bp)
              <input
                inputMode="numeric"
                list="saucerswap-fee-tiers"
                value={fee}
                onChange={event => setFee(event.target.value)}
                aria-invalid={feeValue === null}
                className={`input input-sm w-36 font-mono tabular-nums ${feeValue === null ? "input-error" : ""}`}
              />
              <datalist id="saucerswap-fee-tiers">
                {FEE_TIERS.map(tier => (
                  <option key={tier} value={tier}>
                    {formatPercent(tier / 1_000_000, 2)}
                  </option>
                ))}
              </datalist>
            </label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!ready || writer.pending !== null}>
              {writer.pending === "setPoolFee" && <span className="loading loading-spinner loading-xs" aria-hidden />}
              Set fee tier
            </button>
            {a !== undefined && a.address === b?.address && (
              <p className="m-0 w-full text-xs font-medium">Pick two different tokens.</p>
            )}
          </form>
        )}
      </div>
    </Panel>
  );
};
