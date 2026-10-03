import { type ReadOnlyConfig } from "../config";

/** Shorter values are left alone: replacing them would mangle unrelated text, and nothing that short is a secret. */
const MIN_REDACTED_LENGTH = 8;

/**
 * Replaces every occurrence of each value in `message` with `[label]`, so the reader knows what was cut. A hex value
 * is also matched without its 0x prefix, the form libraries often print.
 */
export function redactValues(message: string, values: Record<string, string | undefined>): string {
  let redacted = message;
  for (const [label, raw] of Object.entries(values)) {
    const value = raw?.trim();
    if (!value) continue;
    for (const form of new Set([value, value.replace(/^0x/i, "")])) {
      if (form.length >= MIN_REDACTED_LENGTH) redacted = redacted.split(form).join(`[${label}]`);
    }
  }
  return redacted;
}

/**
 * Hides the JSON-RPC relay and Mirror Node URLs in a message that is shown beyond the operator's own terminal (an
 * LLM, an HTTP client): commercial providers embed API keys in them, and viem and fetch errors quote the URL.
 */
export function redactUrls(message: string, urls: Pick<ReadOnlyConfig, "rpcUrl" | "mirrorUrl">): string {
  return redactValues(message, { HEDERA_RPC_URL: urls.rpcUrl, HEDERA_MIRROR_URL: urls.mirrorUrl });
}
