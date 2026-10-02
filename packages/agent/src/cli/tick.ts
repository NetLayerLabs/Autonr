import { parseArgs } from "node:util";
import { printStep, tickSummary } from "../agent/log";
import { runTick } from "../agent/tick";
import { loadAgentConfig, scriptCommand } from "../config";
import { type ManualAction } from "../strategy/types";
import { cliArgs, EXIT, parseUsd, runCli, UsageError } from "./_shared";

const USAGE = `Usage: ${scriptCommand("agent:tick", "[--dry-run] [--buy <usd> | --sell <usd>]")}

Runs one agent cycle: read the oracles and the vault, decide, check the pool, simulate,
publish the decision to HCS, then trade through the vault.

  --dry-run      decide and simulate only: publish nothing, send nothing
  --buy <usd>    buy this many US dollars of the base token instead of asking the strategy
  --sell <usd>   sell this many US dollars of the base token instead of asking the strategy
  -h, --help     show this help`;

await runCli(USAGE, async () => {
  const { values } = parseArgs({
    args: cliArgs(),
    options: {
      "dry-run": { type: "boolean", default: false },
      buy: { type: "string" },
      sell: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return EXIT.ok;
  }
  if (values.buy && values.sell) throw new UsageError("use either --buy or --sell, not both");
  const manual: ManualAction | undefined = values.buy
    ? { side: "buy", usd: parseUsd("--buy", values.buy) }
    : values.sell
      ? { side: "sell", usd: parseUsd("--sell", values.sell) }
      : undefined;

  const cfg = loadAgentConfig();
  const strategy = manual ? `manual ${manual.side}` : cfg.strategy;
  console.log(`tick on ${cfg.network}: vault ${cfg.vaultAddress}, agent ${cfg.agentAccountId}, strategy ${strategy}`);
  const result = await runTick(cfg, { dryRun: values["dry-run"], manual, onStep: printStep });
  for (const line of tickSummary(cfg, result)) console.log(line);
  return EXIT.ok;
});
