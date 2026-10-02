"use client";

import { type FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { isTxHash, mirrorTransactionId } from "@sh/agent/hedera";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";

/** Opens the proof page for a trade, given its EVM transaction hash or its Hedera transaction id. */
export const ProofSearch = ({ className = "", onNavigate }: { className?: string; onNavigate?: () => void }) => {
  const router = useRouter();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const tx = value.trim();
    if (!isTxHash(tx) && mirrorTransactionId(tx) === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setValue("");
    onNavigate?.();
    router.push(`/proof/${encodeURIComponent(tx)}`);
  };

  return (
    <form role="search" onSubmit={submit} className={`relative ${className}`}>
      <label className={`input input-sm w-full ${invalid ? "input-error" : ""}`}>
        <MagnifyingGlassIcon className="h-4 w-4 opacity-60" aria-hidden />
        <input
          type="search"
          value={value}
          onChange={event => {
            setValue(event.target.value);
            setInvalid(false);
          }}
          placeholder="Verify a trade: tx hash or 0.0.x@s.n"
          aria-label="Verify a trade by EVM transaction hash or Hedera transaction id"
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          spellCheck={false}
          autoComplete="off"
          className="grow font-mono text-xs"
        />
      </label>
      {invalid && (
        <p
          id={errorId}
          role="alert"
          className="absolute left-0 right-0 top-full z-30 m-0 mt-1 rounded-box border border-base-300 bg-base-100 px-3 py-2 text-xs shadow-md"
        >
          Enter a 0x transaction hash (64 hex characters) or a Hedera transaction id such as 0.0.1234@1727800000.1.
        </p>
      )}
    </form>
  );
};
