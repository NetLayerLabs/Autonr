import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { loadStrategy } from "../src/strategy";
import { llmStrategy } from "../src/strategy/llm";
import { type StrategyInput } from "../src/strategy/types";
import { agentConfig, marketSnapshot, vaultState } from "./fixtures";

const input: StrategyInput = { snapshot: marketSnapshot(), state: vaultState(), cfg: agentConfig() };
const settings = { apiKey: "test-key", model: "claude-sonnet-5-5" };

/** A model that answers with `text` as its final message, the way a provider returns structured output. */
function modelAnswering(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "claude-sonnet-5-5",
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: {
        inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 60, text: 60, reasoning: undefined },
      },
      warnings: [],
      response: { modelId: "claude-sonnet-5-5" },
    },
  });
}

const decide = (model: MockLanguageModelV3) => llmStrategy(settings, model).decide(input);

describe("llm strategy", () => {
  it("turns a valid answer into a trade and records the model that gave it", async () => {
    const answer = { action: "sell", usd: 4, rationale: "WHBAR is 84% of the vault against a 50% target." };
    expect(await decide(modelAnswering(JSON.stringify(answer)))).toEqual({
      kind: "trade",
      side: "sell",
      usd: 4,
      rationale: answer.rationale,
      model: "claude-sonnet-5-5",
    });
  });

  it("passes a hold through", async () => {
    const answer = { action: "hold", usd: 0, rationale: "Prices are flat." };
    expect(await decide(modelAnswering(JSON.stringify(answer)))).toMatchObject({
      kind: "hold",
      rationale: "Prices are flat.",
    });
  });

  it("shows the model the oracles, the balances and the vault's limits", async () => {
    const model = modelAnswering(JSON.stringify({ action: "hold", usd: 0, rationale: "ok" }));
    await decide(model);
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    for (const fact of ["Chainlink", "HBAR / USD", "500 WHBAR", "10 USDC", "at most $10.00 per trade", "$40.00 left"]) {
      expect(prompt).toContain(fact);
    }
    expect(prompt).toContain("never try to work around a limit");
  });

  it.each([
    ["text that is not JSON", "I would sell some WHBAR."],
    ["a negative size", JSON.stringify({ action: "buy", usd: -3, rationale: "Buy." })],
    ["an unknown action", JSON.stringify({ action: "short", usd: 3, rationale: "Short it." })],
    ["an overlong rationale", JSON.stringify({ action: "buy", usd: 3, rationale: "x".repeat(301) })],
  ])("holds on %s", async (_case, text) => {
    const decision = await decide(modelAnswering(text));
    expect(decision.kind).toBe("hold");
    expect(decision.rationale).toMatch(/^llm unavailable: /);
  });

  it("holds when the model cannot be reached", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    expect(await decide(model)).toMatchObject({ kind: "hold", rationale: expect.stringContaining("ECONNREFUSED") });
  });

  it("holds instead of selling more than the vault has", async () => {
    const answer = { action: "sell", usd: 80, rationale: "Sell everything." };
    const decision = await decide(modelAnswering(JSON.stringify(answer)));
    expect(decision).toMatchObject({ kind: "hold" });
    expect(decision.rationale).toContain("but the vault holds $51.23 of WHBAR");
  });
});

describe("loadStrategy", () => {
  it("uses the manual action when one is given", async () => {
    const strategy = await loadStrategy(agentConfig(), { side: "buy", usd: 2 });
    expect(strategy.id).toBe("manual");
    expect(await strategy.decide(input)).toMatchObject({ kind: "trade", side: "buy", usd: 2 });
  });

  it("defaults to rebalance and loads the llm strategy on demand", async () => {
    expect((await loadStrategy(agentConfig())).id).toBe("rebalance");
    const cfg = agentConfig({ strategy: "llm", llm: settings });
    expect((await loadStrategy(cfg)).id).toBe("llm");
  });
});
