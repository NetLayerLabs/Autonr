"use client";

import { type FormEvent, useState } from "react";
import type { VaultWriter } from "./useVaultWriter";
import { hashscanUrl } from "@sh/agent/hedera";
import type { NetworkName } from "@sh/agent/networks";
import { type Address, isAddress } from "viem";
import { EntityId } from "~~/components/autonr/EntityId";
import { Panel } from "~~/components/autonr/Panel";

type AgentFormProps = { network: NetworkName; agent: Address; canWrite: boolean; writer: VaultWriter };

export const AgentForm = ({ network, agent, canWrite, writer }: AgentFormProps) => {
  const [next, setNext] = useState("");
  const candidate = next.trim();
  const valid = isAddress(candidate);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) return;
    void writer.send("setAgent", target =>
      writer.writeContractAsync({ ...target, functionName: "setAgent", args: [candidate] }),
    );
  };

  return (
    <Panel
      title="Agent"
      description="The only address allowed to call executeSwap. It must also hold the decision topic's submit key."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
          Current agent <EntityId value={agent} href={hashscanUrl(network, "account", agent)} short />
        </p>
        {canWrite && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 grow flex-col gap-1 text-xs">
              New agent EVM address
              <input
                value={next}
                onChange={event => setNext(event.target.value)}
                placeholder="0x…"
                aria-invalid={next !== "" && !valid}
                className={`input input-sm w-full font-mono ${next !== "" && !valid ? "input-error" : ""}`}
              />
            </label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!valid || writer.pending !== null}>
              {writer.pending === "setAgent" && <span className="loading loading-spinner loading-xs" aria-hidden />}
              Set agent
            </button>
          </div>
        )}
      </form>
    </Panel>
  );
};
