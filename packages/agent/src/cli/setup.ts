import { parseArgs } from "node:util";
import { line } from "../agent/log";
import { scriptCommand } from "../config";
import { AGENT_ENV_FILE } from "../env-file";
import { runSetup } from "../ops/setup";
import { cliArgs, EXIT, runCli } from "./_shared";

const USAGE = `Usage: ${scriptCommand("agent:setup")}

Prepares the agent as the vault owner (OPERATOR_ACCOUNT_ID / OPERATOR_PRIVATE_KEY):
  1. creates the agent's ECDSA account if AGENT_ACCOUNT_ID is not set (funded by the operator)
  2. creates the HCS decision topic if AUTONR_TOPIC_ID is not set (submit key: the agent)
  3. points the vault at that agent and topic if AUTONR_VAULT_ADDRESS is set
New values are written to packages/agent/.env. Safe to run again: it only does what is missing.

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
  await runSetup({
    env: process.env,
    envFile: AGENT_ENV_FILE,
    onAction: action => {
      console.log(line(action.outcome, `${action.subject}: ${action.detail}`));
      if (action.link) console.log(line("", action.link));
    },
  });
  console.log(`next: ${scriptCommand("agent:doctor")}, then ${scriptCommand("agent:dry-run")}`);
  return EXIT.ok;
});
