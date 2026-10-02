import { parseArgs } from "node:util";
import { describeError, printStep, tickSummary } from "../agent/log";
import { runTick, SetupMismatchError } from "../agent/tick";
import { loadAgentConfig, scriptCommand } from "../config";
import { cliArgs, EXIT, runCli, UsageError } from "./_shared";

const USAGE = `Usage: ${scriptCommand("agent:loop", "[--interval <seconds>]")}

Runs an agent cycle, waits, and repeats until interrupted. Ctrl-C finishes the current
cycle and exits; a second Ctrl-C exits at once.

  --interval <s>   seconds between the end of one cycle and the start of the next (default 60)
  -h, --help       show this help`;

/** Ticks closer together than this mostly publish cooldown holds. */
const MIN_INTERVAL_SECONDS = 10;

await runCli(USAGE, async () => {
  const { values } = parseArgs({
    args: cliArgs(),
    options: {
      interval: { type: "string", default: "60" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return EXIT.ok;
  }
  const intervalSeconds = Number(values.interval);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS) {
    throw new UsageError(
      `--interval expects whole seconds, at least ${MIN_INTERVAL_SECONDS}; got "${values.interval}"`,
    );
  }

  const cfg = loadAgentConfig();
  let stopping = false;
  let wake: () => void = () => {};
  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\nstopping after the current cycle (Ctrl-C again to quit now)");
    wake();
  });

  console.log(
    `loop on ${cfg.network}: vault ${cfg.vaultAddress}, strategy ${cfg.strategy}, every ${intervalSeconds} s`,
  );
  while (!stopping) {
    console.log(`\n[${new Date().toISOString()}]`);
    try {
      const result = await runTick(cfg, { onStep: printStep });
      for (const line of tickSummary(cfg, result)) console.log(line);
    } catch (error) {
      // A wiring problem fails every cycle the same way; anything else (a relay hiccup) may pass next time.
      if (error instanceof SetupMismatchError) throw error;
      console.error(`cycle failed: ${describeError(error)}`);
    }
    if (stopping) break;
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, intervalSeconds * 1000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
  return EXIT.ok;
});
