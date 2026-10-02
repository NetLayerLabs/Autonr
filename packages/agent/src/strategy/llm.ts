import { type AnthropicLanguageModelOptions, createAnthropic } from "@ai-sdk/anthropic";
import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { e18ToNumber, formatUsd, formatUsdPrice } from "../oracles/math";
import { type OracleSnapshot } from "../oracles/snapshot";
import { type Portfolio, portfolioOf } from "./portfolio";
import { type Strategy, type StrategyDecision, type StrategyInput } from "./types";

const LLM_TIMEOUT_MS = 20_000;

const llmDecisionSchema = z.object({
  action: z
    .enum(["buy", "sell", "hold"])
    .describe("buy: spend the quote token on the base token; sell: the reverse; hold: no trade"),
  usd: z.number().min(0).describe("Trade size in USD; 0 when holding"),
  rationale: z.string().max(300).describe("Why, citing the figures relied on; published verbatim on Hedera"),
});

type LlmDecision = z.infer<typeof llmDecisionSchema>;

/**
 * A single structured decision is a small task, so low effort keeps it well inside the timeout. Server-side fallbacks
 * let the API answer with another model if a safety classifier declines; the decision log records whichever model
 * answered.
 */
const anthropicOptions = { effort: "low", fallbacks: "default" } satisfies AnthropicLanguageModelOptions;

/**
 * Asks a Claude model whether to trade. The model only chooses direction and size: the vault prices the trade with
 * its oracles and enforces every limit, so a wrong or manipulated answer can at worst be refused. Any failure (timeout,
 * refusal, output that does not match the schema) becomes a hold that says why.
 */
export function llmStrategy(
  settings: { apiKey: string; model: string },
  model: LanguageModel = createAnthropic({ apiKey: settings.apiKey })(settings.model),
): Strategy {
  return {
    id: "llm",
    version: "1",
    decide: async input => {
      const portfolio = portfolioOf(input.cfg, input.snapshot, input.state);
      try {
        const { output, response } = await generateText({
          model,
          system: systemPrompt(portfolio),
          prompt: situation(input, portfolio),
          output: Output.object({ name: "decision", schema: llmDecisionSchema }),
          timeout: LLM_TIMEOUT_MS,
          maxOutputTokens: 4_096,
          providerOptions: { anthropic: anthropicOptions },
        });
        return toDecision(output, portfolio, response.modelId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { kind: "hold", rationale: `llm unavailable: ${reason}`, model: settings.model };
      }
    },
  };
}

/** Validates the model's answer against what the vault holds; anything it cannot carry out becomes a hold. */
function toDecision(output: LlmDecision, portfolio: Portfolio, model: string): StrategyDecision {
  if (output.action === "hold") return { kind: "hold", rationale: output.rationale, model };
  const selling = output.action === "sell" ? portfolio.base : portfolio.quote;
  if (output.usd <= 0) {
    return { kind: "hold", rationale: `llm proposed an empty ${output.action}: ${output.rationale}`, model };
  }
  if (output.usd > selling.usd) {
    const holds = `${formatUsd(selling.usd)} of ${selling.token.symbol}`;
    return {
      kind: "hold",
      rationale: `llm proposed a ${formatUsd(output.usd)} ${output.action} but the vault holds ${holds}: ${output.rationale}`,
      model,
    };
  }
  return { kind: "trade", side: output.action, usd: output.usd, rationale: output.rationale, model };
}

function systemPrompt({ base, quote }: Portfolio): string {
  const [b, q] = [base.token.symbol, quote.token.symbol];
  return [
    `You decide whether an autonomous trading agent trades now. It manages a vault on Hedera holding ${b} and ${q}:`,
    `you may buy ${b} with ${q}, sell ${b} for ${q}, or hold.`,
    "The vault prices every trade with Chainlink and Supra oracles and enforces a per-trade cap, a daily cap, a",
    "cooldown and a slippage limit; it rejects anything outside them, so never try to work around a limit.",
    "Size trades in USD and never propose more than the vault holds of the token being sold.",
    "Prefer holding when the evidence is weak.",
    "Your rationale, at most 300 characters, is published verbatim on the Hedera Consensus Service: state the",
    "figures you relied on.",
  ].join(" ");
}

function situation({ snapshot, state, cfg }: StrategyInput, portfolio: Portfolio): string {
  const { policy } = state;
  const dailyCap = e18ToNumber(BigInt(policy.dailyCapUsd));
  const weight = portfolio.baseWeight === null ? "the vault is empty" : `${(portfolio.baseWeight * 100).toFixed(1)}%`;
  return [
    `Consensus time: ${new Date(snapshot.fetchedAt * 1000).toISOString()}`,
    "Oracle prices:",
    `- ${describeOracle(snapshot.base)}`,
    `- ${describeOracle(snapshot.quote)}`,
    "Vault holdings:",
    ...[portfolio.base, portfolio.quote].map(h => `- ${h.amount} ${h.token.symbol} = ${formatUsd(h.usd)}`),
    `- ${portfolio.base.token.symbol} weight: ${weight} of ${formatUsd(portfolio.totalUsd)}; owner's target ${(cfg.targetBaseWeight * 100).toFixed(1)}%`,
    "Policy the vault enforces:",
    `- at most ${formatUsd(e18ToNumber(BigInt(policy.maxTradeUsd)))} per trade`,
    `- ${formatUsd(e18ToNumber(BigInt(state.remainingDailyUsd)))} left of today's ${formatUsd(dailyCap)} cap`,
    `- at least ${policy.cooldown} s between trades`,
    `- oracle prices at most ${policy.maxPriceAge} s old, Chainlink and Supra within ${policy.maxOracleDivergenceBps} bps`,
    `- at most ${policy.maxSlippageBps} bps below the oracle price on execution`,
  ].join("\n");
}

function describeOracle(oracle: OracleSnapshot): string {
  const primary = `${oracle.symbol} ${formatUsdPrice(oracle.priceUsd)} from ${oracle.source} ${oracle.feed}, ${oracle.ageSeconds} s old`;
  if (!oracle.crossCheck) return primary;
  const { priceUsd, divergenceBps } = oracle.crossCheck;
  return `${primary}; Supra says ${formatUsdPrice(priceUsd)} (${divergenceBps} bps apart)`;
}
