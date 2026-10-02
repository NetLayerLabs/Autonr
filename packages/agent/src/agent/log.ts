import { BaseError, HttpRequestError } from "viem";
import { type ReadOnlyConfig, scriptCommand } from "../config";
import { hashscanTopicMessageUrl, hashscanUrl } from "../hedera";
import { type TickResult, type TickStep } from "./tick";

const LABEL_WIDTH = 10;

/** "  label     detail": the one-line-per-step format every CLI uses. */
export function line(label: string, detail: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${detail}`;
}

/**
 * One line for any error, never a stack trace. viem's full message appends docs links and a version footer, so its
 * short message and details are used instead; a request the JSON-RPC relay failed names the relay to check.
 */
export function describeError(error: unknown): string {
  const text = (() => {
    if (!(error instanceof BaseError)) return error instanceof Error ? error.message : String(error);
    const http = error.walk(cause => cause instanceof HttpRequestError);
    if (http instanceof HttpRequestError) {
      return `the JSON-RPC relay at ${http.url} failed (${http.details || http.shortMessage}); check HEDERA_RPC_URL`;
    }
    return [error.shortMessage, error.details].filter(Boolean).join(" ");
  })();
  return text.replace(/\s*\n\s*/g, " ");
}

export function printStep({ step, detail }: TickStep): void {
  console.log(line(step, detail));
}

/** Final lines of a tick: the outcome, then where to see and verify it. */
export function tickSummary(cfg: ReadOnlyConfig, result: TickResult): string[] {
  const seconds = (result.durationMs / 1000).toFixed(1);
  const outcome = result.rejection
    ? `rejected at ${result.rejection.stage}: ${result.rejection.error}`
    : result.kind === "hold"
      ? "hold"
      : "trade";
  const lines = [`${outcome}${result.dryRun ? " (dry run: nothing published or sent)" : ""} in ${seconds} s`];
  if (result.hcs) {
    lines.push(
      line(
        "decision",
        hashscanTopicMessageUrl(cfg.network, result.hcs.topicId, result.hcs.sequence, result.hcs.consensusTimestamp),
      ),
    );
  } else if (result.kind === "hold" && !result.dryRun) {
    lines.push(line("decision", "not published (AUTONR_LOG_HOLDS=false)"));
  }
  if (result.trade) {
    lines.push(line("trade", result.trade.hashscanUrl));
    lines.push(line("verify", scriptCommand("verify", result.trade.txHash)));
  }
  const revertedTx = result.decision.rejection?.txHash;
  if (revertedTx) lines.push(line("reverted", hashscanUrl(cfg.network, "transaction", revertedTx)));
  return lines;
}
