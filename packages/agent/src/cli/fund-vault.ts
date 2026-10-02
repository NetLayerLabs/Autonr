import { parseArgs } from "node:util";
import { formatUnits, parseUnits } from "viem";
import { line } from "../agent/log";
import {
  loadOperatorConfig,
  loadReadOnlyConfig,
  type OperatorConfig,
  type ReadOnlyConfig,
  scriptCommand,
} from "../config";
import { entityIdFromLongZero } from "../hedera";
import { getNetwork } from "../networks";
import {
  confirmFunding,
  executeFunding,
  type FundingPlan,
  type FundingStep,
  formatHbar,
  HBAR_DECIMALS,
  planFunding,
} from "../ops/market/fund-vault";
import { formatFee } from "../saucerswap";
import { cliArgs, EXIT, runCli, UsageError } from "./_shared";

const USAGE = `Usage: ${scriptCommand("vault:fund", "--hbar <amount> [--usdc <amount>] [--dry-run]")}

Wraps HBAR into WHBAR and/or buys USDC with HBAR on SaucerSwap V2, for your vault. Reads
OPERATOR_ACCOUNT_ID, OPERATOR_PRIVATE_KEY and AUTONR_VAULT_ADDRESS from packages/agent/.env.

  --hbar <amount>  HBAR to wrap into WHBAR and send to the vault
  --usdc <amount>  USDC to buy with the operator's HBAR, paid by SaucerSwap straight to the vault
  --dry-run        run every check and print the plan without sending anything
  -h, --help       show this help`;

await runCli(USAGE, async () => {
  const { values } = parseArgs({
    args: cliArgs(),
    options: {
      hbar: { type: "string" },
      usdc: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return EXIT.ok;
  }
  if (values.hbar === undefined && values.usdc === undefined) {
    throw new UsageError("say how much to fund with --hbar, --usdc or both");
  }

  // Unlike the read-only commands, funding never falls back to the reference deployment: that would be a donation.
  if (!process.env.AUTONR_VAULT_ADDRESS?.trim()) {
    throw new Error(`set AUTONR_VAULT_ADDRESS to your vault (deploy one with ${scriptCommand("deploy:testnet")})`);
  }
  const cfg = loadReadOnlyConfig();
  if (!cfg.vaultAddress) throw new Error("AUTONR_VAULT_ADDRESS is not a valid EVM address");
  const operator = loadOperatorConfig();

  const plan = await planFunding(cfg, operator, {
    hbar: values.hbar === undefined ? undefined : parseAmount("--hbar", values.hbar, HBAR_DECIMALS),
    usdc: values.usdc === undefined ? undefined : parseAmount("--usdc", values.usdc, cfg.quoteToken.decimals),
  });

  console.log(`Funding vault ${plan.vault} on ${cfg.network} from ${operator.accountId}`);
  for (const step of plan.steps) console.log(line(step.kind, describeStep(cfg, operator, step)));
  console.log(line("total", `${formatHbar(plan.spendTinybars)} plus network fees`));
  if (values["dry-run"]) {
    console.log("Dry run: nothing was sent.");
    return EXIT.ok;
  }

  for await (const result of executeFunding(cfg, operator, plan)) {
    console.log(line(result.step.kind, result.url));
  }
  await reportBalances(cfg, plan);
  return EXIT.ok;
});

async function reportBalances(cfg: ReadOnlyConfig, plan: FundingPlan): Promise<void> {
  for (const check of await confirmFunding(cfg, plan)) {
    const { symbol, decimals } = check.token;
    if (!check.confirmed || check.after === null) {
      console.log(
        line("vault", `the Mirror Node has not caught up on ${symbol} yet; the transactions above are final`),
      );
      continue;
    }
    const gained = formatUnits(check.after - check.before, decimals);
    console.log(
      line("vault", `holds ${formatUnits(check.after, decimals)} ${symbol} (+${gained}) per the Mirror Node`),
    );
  }
}

function describeStep(cfg: ReadOnlyConfig, operator: OperatorConfig, step: FundingStep): string {
  const quote = cfg.quoteToken;
  switch (step.kind) {
    case "associate":
      return `${operator.accountId} with ${step.token.symbol} (${step.token.id}) so it can hold the token`;
    case "wrap": {
      const whbarContract = entityIdFromLongZero(getNetwork(cfg.network).saucerswap.whbar);
      return `${formatHbar(step.tinybars)} into WHBAR with the WHBAR contract ${whbarContract}`;
    }
    case "transfer":
      return `${formatUnits(step.amount, step.token.decimals)} ${step.token.symbol} to the vault`;
    case "swap": {
      const expected = formatUnits(step.quote.amountOut, quote.decimals);
      const basis = step.quote.source === "spot" ? `${expected} at the pool's spot price` : `quoted ${expected}`;
      return (
        `${formatHbar(step.tinybars)} for at least ${formatUnits(step.minOut, quote.decimals)} ${quote.symbol} ` +
        `(${basis}) on SaucerSwap V2's ${formatFee(cfg.poolFee)} pool, paid to the vault`
      );
    }
  }
}

function parseAmount(flag: string, value: string, decimals: number): bigint {
  const match = /^\d+(?:\.(\d+))?$/.exec(value);
  if (!match || (match[1]?.length ?? 0) > decimals) {
    throw new UsageError(
      `${flag} takes a positive number with at most ${decimals} decimals, e.g. 5 or 2.5 (got "${value}")`,
    );
  }
  const amount = parseUnits(value, decimals);
  if (amount === 0n) throw new UsageError(`${flag} must be more than zero`);
  return amount;
}
