"use client";

import { useEffect, useState } from "react";
import { ClipboardDocumentCheckIcon, ClipboardDocumentIcon } from "@heroicons/react/20/solid";

export const CopyButton = ({ value, label }: { value: string; label: string }) => {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setFailed(false);
      setCopied(true);
    } catch {
      // Clipboard access needs a secure context (https or localhost) and a user gesture.
      setFailed(true);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="btn btn-ghost btn-xs h-6 min-h-6 w-6 shrink-0 p-0"
      aria-label={copied ? "Copied" : label}
      title={failed ? "Copy failed: the clipboard is only available over https or on localhost" : label}
    >
      {copied ? (
        <ClipboardDocumentCheckIcon className="h-4 w-4 text-primary" aria-hidden />
      ) : (
        <ClipboardDocumentIcon className="h-4 w-4 opacity-60" aria-hidden />
      )}
    </button>
  );
};
