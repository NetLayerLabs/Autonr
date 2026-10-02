import { parseArgs } from "node:util";
import { line } from "../agent/log";
import { scriptCommand } from "../config";
import { runDoctor } from "../ops/doctor";
import { cliArgs, EXIT, runCli } from "./_shared";

const USAGE = `Usage: ${scriptCommand("agent:doctor")}

Checks everything a trade depends on: configuration, the JSON-RPC relay and Mirror Node,
the agent account, the vault, the decision topic's submit key, token configuration and
association, oracle freshness and agreement, and the SaucerSwap pool. Prints one
PASS / WARN / FAIL line per check with a fix, and exits 1 if anything fails.

  -h, --help   show this help`;

await runCli(USAGE, async () => {
  const { values } = parseArgs({
    args: cliArgs(),
    options: { help: { type: "boolean", short: "h", default: false } },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return EXIT.ok;
  }
  const checks = await runDoctor({
    env: process.env,
    onCheck: check => {
      console.log(line(check.status.toUpperCase(), `${check.title}: ${check.detail}`));
      if (check.fix) console.log(line("", `fix: ${check.fix}`));
    },
  });
  return checks.some(check => check.status === "fail") ? EXIT.failure : EXIT.ok;
});
