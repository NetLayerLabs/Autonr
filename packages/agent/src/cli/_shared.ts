import { config as loadDotenv } from "dotenv";
import { describeError } from "../agent/log";
import { ConfigError, scriptCommand } from "../config";
import { AGENT_ENV_FILE } from "../env-file";

/** Exit codes shared by every CLI. */
export const EXIT = { ok: 0, failure: 1, usage: 2 } as const;

/** A bad flag or flag value; printed with the usage text. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Command-line arguments after the script name. Package managers differ in whether they forward the "--" that
 * separates their own flags from the script's, so a leading one is dropped.
 */
export function cliArgs(): string[] {
  const args = process.argv.slice(2);
  return args[0] === "--" ? args.slice(1) : args;
}

/** A positive number of US dollars from a flag value. */
export function parseUsd(flag: string, value: string): number {
  const usd = Number(value);
  if (!Number.isFinite(usd) || usd <= 0) throw new UsageError(`${flag} expects a positive USD amount, got "${value}"`);
  return usd;
}

/**
 * Runs a CLI entry point: loads packages/agent/.env (whatever the working directory; variables already in the
 * environment win), then prints any failure as one actionable message, never a stack trace, and sets the exit code.
 */
export async function runCli(usage: string, main: () => Promise<number>): Promise<void> {
  loadDotenv({ path: AGENT_ENV_FILE, quiet: true });
  try {
    process.exitCode = await main();
  } catch (error) {
    process.exitCode = printFailure(error, usage);
  }
}

function printFailure(error: unknown, usage: string): number {
  if (error instanceof UsageError || isParseArgsError(error)) {
    console.error(`${(error as Error).message}\n\n${usage}`);
    return EXIT.usage;
  }
  if (error instanceof ConfigError) {
    console.error("Set these in packages/agent/.env (start from packages/agent/.env.example):");
    const width = Math.max(...error.issues.map(issue => issue.variable.length));
    for (const issue of error.issues) console.error(`  ${issue.variable.padEnd(width)}  ${issue.problem}`);
    console.error(`${scriptCommand("agent:doctor")} checks the whole setup once they are in place.`);
    return EXIT.failure;
  }
  console.error(`error: ${describeError(error)}`);
  return EXIT.failure;
}

/** node:util parseArgs reports unknown flags and missing values as TypeErrors with ERR_PARSE_ARGS_* codes. */
function isParseArgsError(error: unknown): boolean {
  return error instanceof TypeError && String((error as NodeJS.ErrnoException).code).startsWith("ERR_PARSE_ARGS");
}
