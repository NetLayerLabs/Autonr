import { parseArgs } from "node:util";
import { createAnthropic } from "@ai-sdk/anthropic";
import { AgentMode } from "@hashgraph/hedera-agent-kit";
import { generateText, stepCountIs } from "ai";
import { line, printStep } from "../agent/log";
import { type AgentConfig, loadAgentConfig, scriptCommand } from "../config";
import { autonrPlugin, autonrToolNames, hederaAiSdkTools } from "../hak";
import { hederaClient } from "../hcs/client";
import { cliArgs, EXIT, runCli, UsageError } from "./_shared";

const DEFAULT_PROMPT = "Check the market and the vault, and decide whether to rebalance the vault.";
const DEFAULT_MAX_STEPS = 8;

const USAGE = `Usage: ${scriptCommand("agent:hak", "[--dry-run] [--prompt <text>] [--max-steps <n>]")}

Runs one Hedera Agent Kit agent (Claude through the Vercel AI SDK) whose only tools are the
Autonr plugin: it can read the market and the vault, and trade only through the AgentVault,
which refuses any trade whose reasoning is not on HCS first.

  --dry-run          the agent may propose, but nothing is published or sent
  --prompt <text>    what to ask (default: "${DEFAULT_PROMPT}")
  --max-steps <n>    model/tool round trips before stopping (default ${DEFAULT_MAX_STEPS})
  -h, --help         show this help

Needs ANTHROPIC_API_KEY (model: AUTONR_LLM_MODEL) and the agent variables used by agent:tick.`;

await runCli(USAGE, async () => {
  const { values } = parseArgs({
    args: cliArgs(),
    options: {
      "dry-run": { type: "boolean", default: false },
      prompt: { type: "string" },
      "max-steps": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return EXIT.ok;
  }
  const maxSteps = values["max-steps"] === undefined ? DEFAULT_MAX_STEPS : stepsFlag(values["max-steps"]);
  const cfg = loadAgentConfig();
  if (cfg.llm === null) {
    console.error("The HAK example agent needs an LLM: set ANTHROPIC_API_KEY in packages/agent/.env.");
    console.error(`Without one, ${scriptCommand("agent:tick")} trades with the deterministic rebalance strategy.`);
    return EXIT.failure;
  }
  const dryRun = values["dry-run"];
  console.log(
    `HAK agent on ${cfg.network}: vault ${cfg.vaultAddress}, agent ${cfg.agentAccountId}, model ${cfg.llm.model}` +
      (dryRun ? " (dry run)" : ""),
  );

  // HederaAgentAPI requires a client, but no Autonr tool uses it: runTick signs with its own. It is built the same
  // way (agent operator, gRPC-web unless HEDERA_GRPC_TRANSPORT=native) so any HAK tool the host adds behaves alike.
  const client = hederaClient(cfg.network, cfg.agentAccountId, cfg.agentPrivateKey);
  try {
    const tools = hederaAiSdkTools(client, {
      plugins: [autonrPlugin({ dryRun, model: `hak/${cfg.llm.model}`, onStep: printStep })],
      context: { accountId: cfg.agentAccountId, mode: AgentMode.AUTONOMOUS },
    });
    const { text } = await generateText({
      model: createAnthropic({ apiKey: cfg.llm.apiKey })(cfg.llm.model),
      system: systemPrompt(cfg),
      prompt: values.prompt ?? DEFAULT_PROMPT,
      tools,
      stopWhen: stepCountIs(maxSteps),
      onStepFinish: ({ toolCalls }) => {
        for (const call of toolCalls) console.log(line("tool", `${call.toolName} ${JSON.stringify(call.input)}`));
      },
    });
    console.log("");
    console.log(text || "(the agent ended without a final message)");
  } finally {
    client.close();
  }
  return EXIT.ok;
});

function systemPrompt(cfg: AgentConfig): string {
  const [base, quote] = [cfg.baseToken.symbol, cfg.quoteToken.symbol];
  return [
    `You manage an Autonr AgentVault on Hedera ${cfg.network} holding ${base} and ${quote}.`,
    `Start with ${autonrToolNames.MARKET_SNAPSHOT} and ${autonrToolNames.VAULT_STATE}.`,
    `The owner aims for ${(cfg.targetBaseWeight * 100).toFixed(0)}% of the vault's value in ${base}; trades of about $${cfg.tradeUsd} are typical.`,
    `The only way to trade is ${autonrToolNames.PROPOSE_TRADE}: you give a side, a USD size and a rationale citing the figures you used.`,
    "You never give a price: the vault prices the trade with Chainlink and Supra and enforces its own caps and cooldown.",
    "Your rationale is published to HCS before the trade, so write it for a public audit log.",
    "Do not propose a trade the pool check says the vault would refuse, or when the vault is close to its target; say why you hold instead.",
    `After a trade, check it with ${autonrToolNames.VERIFY_TRADE}. Finish with a short summary.`,
  ].join(" ");
}

function stepsFlag(value: string): number {
  const steps = Number(value);
  if (!Number.isInteger(steps) || steps < 1 || steps > 20) {
    throw new UsageError(`--max-steps expects a whole number from 1 to 20, got "${value}"`);
  }
  return steps;
}
