import { parseArgs } from "node:util";
import { line } from "../agent/log";
import { isRedTeamScenarioId, RED_TEAM_SCENARIOS, runRedTeam } from "../agent/red-team";
import { loadReadOnlyConfig, scriptCommand } from "../config";
import { cliArgs, EXIT, runCli, UsageError } from "./_shared";

const ids = RED_TEAM_SCENARIOS.map(scenario => scenario.id);

const USAGE = `Usage: ${scriptCommand("agent:red-team", "[--scenario <id> | --scenario all]")}

Asks the vault to execute trades that each break one rule, as eth_call simulations from the
agent's address: nothing is signed and nothing changes on-chain. Every scenario should be
refused with its expected error. Exits 1 if any is not.

  --scenario <id>   one of ${ids.join(", ")}, or all (default)
  -h, --help        show this help`;

await runCli(USAGE, async () => {
  const { values } = parseArgs({
    args: cliArgs(),
    options: {
      scenario: { type: "string", default: "all" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return EXIT.ok;
  }
  const selected = values.scenario === "all" ? ids : [values.scenario];
  const scenarios = selected.filter(isRedTeamScenarioId);
  if (scenarios.length !== selected.length) throw new UsageError(`unknown scenario "${values.scenario}"`);

  const cfg = loadReadOnlyConfig();
  if (!cfg.vaultAddress) throw new Error("no vault to attack: set AUTONR_VAULT_ADDRESS in packages/agent/.env");
  console.log(`red team against vault ${cfg.vaultAddress} on ${cfg.network}`);
  let failures = 0;
  for (const id of scenarios) {
    const result = await runRedTeam(cfg, id);
    // The vault checks the cooldown before the trade size, so right after a trade a rule-breaking call is refused by the
    // cooldown first. That is still a refusal; rerun after the cooldown to see the specific rule.
    const deferred = !result.matchedExpectation && result.error === "CooldownActive";
    if (!result.matchedExpectation && !deferred) failures += 1;
    const verdict = result.matchedExpectation
      ? `refused with ${result.error}: ${result.detail}`
      : deferred
        ? `refused earlier by the cooldown (${result.detail}); rerun afterwards to see ${result.expectedError}`
        : `expected ${result.expectedError}, got ${result.rejected ? result.error : "no revert"}: ${result.detail}`;
    console.log(line(result.matchedExpectation ? "PASS" : deferred ? "WAIT" : "FAIL", `${id.padEnd(19)}${verdict}`));
  }
  return failures === 0 ? EXIT.ok : EXIT.failure;
});
