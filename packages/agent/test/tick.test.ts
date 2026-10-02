import { type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { SetupMismatchError, SIMULATION_REASONING_HASH, tick, type TickDeps } from "../src/agent/tick";
import { type AgentConfig } from "../src/config";
import { decodeDecision, type EncodedDecision } from "../src/decision";
import { rebalanceStrategy } from "../src/strategy/rebalance";
import { type Strategy, type StrategyDecision } from "../src/strategy/types";
import { type VaultState } from "../src/vault/read";
import { AGENT_ADDRESS, agentConfig, marketSnapshot, NOW, oracle, TOPIC_ID, usdc, vaultState, whbar } from "./fixtures";

const BLOCK = 41_233_019n;
const TX_HASH: Hex = `0x${"ab".repeat(32)}`;
/** What SaucerSwap pays for the $5 WHBAR sale the default fixtures lead to; the vault's minimum is about 4.85 USDC. */
const FAIR_POOL_OUT = 5_100_000n;

type Setup = { state?: VaultState; decision?: StrategyDecision; cfg?: Partial<AgentConfig>; deps?: Partial<TickDeps> };

/** A tick wired to fakes that record the order of everything with an effect outside the process. */
function setup({ state = vaultState(), decision, cfg, deps }: Setup = {}) {
  const effects: string[] = [];
  const published: EncodedDecision[] = [];
  const strategy: Strategy = decision
    ? { id: "llm", version: "1", decide: vi.fn(async () => decision) }
    : { ...rebalanceStrategy, decide: vi.fn(rebalanceStrategy.decide) };
  const fakes = {
    snapshot: vi.fn(async () => marketSnapshot()),
    vaultState: vi.fn(async () => state),
    strategy: vi.fn(async () => strategy),
    poolQuote: vi.fn<TickDeps["poolQuote"]>(async () => ({ amountOut: FAIR_POOL_OUT, source: "quoter" })),
    blockNumber: vi.fn(async () => BLOCK),
    simulate: vi.fn<TickDeps["simulate"]>(async () => {
      effects.push("simulate");
      return { ok: true, amountOut: FAIR_POOL_OUT };
    }),
    execute: vi.fn<TickDeps["execute"]>(async call => {
      effects.push("execute");
      return { ok: true, txHash: TX_HASH, tradeId: 4, amountIn: call.request.amountIn, amountOut: FAIR_POOL_OUT };
    }),
    publish: vi.fn(async (encoded: EncodedDecision) => {
      effects.push(`publish ${encoded.record.kind}`);
      published.push(encoded);
      return {
        topicId: TOPIC_ID,
        sequence: 41 + published.length,
        consensusTimestamp: `${NOW + published.length}.000000001`,
        transactionId: `0.0.5004@${NOW}.000000000`,
      };
    }),
    now: () => new Date(NOW * 1000),
  } satisfies TickDeps;
  return { fakes, deps: { ...fakes, ...deps }, effects, published, strategy, cfg: agentConfig(cfg) };
}

describe("tick", () => {
  it("publishes the reasoning, then trades citing its hash and sequence", async () => {
    const { fakes, deps, effects, published, cfg } = setup();
    const result = await tick(cfg, {}, deps);

    expect(effects).toEqual(["simulate", "publish trade", "execute"]);
    const [trade] = published;
    expect(decodeDecision(trade!.bytes)).toMatchObject({ ok: true, hash: trade!.hash });
    expect(trade!.record).toMatchObject({
      kind: "trade",
      vault: cfg.vaultAddress,
      agent: cfg.agentAccountId,
      strategy: { id: "rebalance", version: "1" },
      action: { side: "sell", tokenIn: whbar.address, tokenOut: usdc.address, poolFee: 3000, usd: "5.00" },
    });
    expect(trade!.record.market).toHaveLength(2);

    expect(fakes.simulate).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { hash: SIMULATION_REASONING_HASH, sequence: 8n } }),
      BLOCK,
    );
    const sent = fakes.execute.mock.calls[0]![0];
    expect(sent.reasoning).toEqual({ hash: trade!.hash, sequence: 42n });
    expect(sent.request.amountIn).toBe(BigInt(trade!.record.action!.amountIn));

    expect(result).toMatchObject({
      kind: "trade",
      dryRun: false,
      hcs: { topicId: TOPIC_ID, sequence: 42 },
      trade: { txHash: TX_HASH, tradeId: 4, hashscanUrl: `https://hashscan.io/testnet/transaction/${TX_HASH}` },
    });
  });

  it("trades in the fee tier the vault approved, not the configured default", async () => {
    const { fakes, deps, published, cfg } = setup({ state: vaultState({ poolFee: 1500 }), cfg: { poolFee: 3000 } });
    await tick(cfg, {}, deps);
    expect(fakes.poolQuote).toHaveBeenCalledWith(expect.objectContaining({ fee: 1500 }));
    expect(fakes.execute.mock.calls[0]![0].request.poolFee).toBe(1500);
    expect(published[0]!.record.action?.poolFee).toBe(1500);
  });

  it("decides and simulates in a dry run, but publishes and sends nothing", async () => {
    const { deps, effects, cfg } = setup();
    const result = await tick(cfg, { dryRun: true }, deps);
    expect(effects).toEqual(["simulate"]);
    expect(result).toMatchObject({ kind: "trade", dryRun: true });
    expect(result.hcs).toBeUndefined();
  });

  it("publishes a hold the strategy decided on", async () => {
    const { fakes, deps, published, cfg } = setup({
      decision: { kind: "hold", rationale: "Nothing to do.", model: "m-1" },
    });
    const result = await tick(cfg, {}, deps);
    expect(result.kind).toBe("hold");
    expect(published.map(entry => entry.record)).toMatchObject([
      { kind: "hold", rationale: "Nothing to do.", strategy: { id: "llm", model: "m-1" } },
    ]);
    expect(fakes.simulate).not.toHaveBeenCalled();
  });

  it("keeps holds out of the log when AUTONR_LOG_HOLDS is false", async () => {
    const { fakes, deps, cfg } = setup({
      decision: { kind: "hold", rationale: "Nothing to do." },
      cfg: { logHolds: false },
    });
    const result = await tick(cfg, {}, deps);
    expect(result).toMatchObject({ kind: "hold", hcs: undefined });
    expect(fakes.publish).not.toHaveBeenCalled();
  });

  it("waits out a cooldown without asking the strategy or publishing anything", async () => {
    const { deps, strategy, cfg, fakes } = setup({ state: vaultState({ nextTradeAt: NOW + 30 }) });
    const result = await tick(cfg, {}, deps);
    expect(result).toMatchObject({ kind: "hold", hcs: undefined });
    expect(result.decision.rationale).toBe("The vault's cooldown ends in 30 s.");
    expect(strategy.decide).not.toHaveBeenCalled();
    expect(fakes.publish).not.toHaveBeenCalled();
  });

  it.each([
    ["the vault is paused", { state: vaultState({ paused: true }) }, "paused"],
    [
      "the pair has no approved fee tier",
      { state: vaultState({ poolFee: 0 }) },
      "has not approved a SaucerSwap fee tier",
    ],
  ] as const)("holds without asking the strategy when %s", async (_case, input, mentions) => {
    const { deps, strategy, cfg } = setup(input);
    const result = await tick(cfg, {}, deps);
    expect(result.kind).toBe("hold");
    expect(result.decision.rationale).toContain(mentions);
    expect(strategy.decide).not.toHaveBeenCalled();
  });

  it.each([
    ["a stale price", oracle(whbar, 10n ** 17n, { ageSeconds: 4_000 }), "is 4000 s old"],
    [
      "diverging oracles",
      oracle(whbar, 10n ** 17n, { crossCheckE18: 12n * 10n ** 16n, divergenceBps: 2_000 }),
      "disagree on WHBAR by 2000 bps",
    ],
  ] as const)("holds on %s, which the vault would refuse", async (_case, base, mentions) => {
    const { deps, strategy, cfg } = setup({ deps: { snapshot: async () => marketSnapshot({ base }) } });
    const result = await tick(cfg, {}, deps);
    expect(result.decision.rationale).toContain(mentions);
    expect(strategy.decide).not.toHaveBeenCalled();
  });

  it("holds and says why when the SaucerSwap pool is priced away from the oracles", async () => {
    const { fakes, deps, cfg } = setup({
      deps: { poolQuote: async () => ({ amountOut: 1_000_000n, source: "quoter" }) },
    });
    const result = await tick(cfg, {}, deps);
    expect(result.kind).toBe("hold");
    expect(result.decision.rationale).toMatch(/^SaucerSwap pool is \d+ bps off the oracle; the vault would refuse/);
    expect(result.decision.rationale).toContain("(it pays 1 USDC, the minimum is");
    expect(result.decision.rationale).toContain("The strategy wanted to sell $5.00");
    expect(fakes.simulate).not.toHaveBeenCalled();
  });

  it("says so when the pool check rests on a spot-price estimate", async () => {
    const { deps, cfg } = setup({ deps: { poolQuote: async () => ({ amountOut: 1_000_000n, source: "spot" }) } });
    const result = await tick(cfg, {}, deps);
    expect(result.decision.rationale).toContain("(it pays about 1 USDC at its spot price, as no quoter answered,");
  });

  it("holds when the vault does not hold enough to sell", async () => {
    const { fakes, deps, cfg } = setup({ decision: { kind: "trade", side: "sell", usd: 100, rationale: "Sell big." } });
    const result = await tick(cfg, {}, deps);
    expect(result.kind).toBe("hold");
    expect(result.decision.rationale).toContain("The vault holds only 500 WHBAR");
    expect(fakes.poolQuote).not.toHaveBeenCalled();
  });

  it("publishes a replayable rejection when the vault refuses the simulation", async () => {
    const refusal = { name: "TradeTooLarge", detail: "trade $50.00 exceeds the per-trade cap $10.00" };
    const { deps, effects, published, cfg } = setup({
      deps: {
        simulate: async () => {
          effects.push("simulate");
          return { ok: false, error: refusal };
        },
      },
    });
    const result = await tick(cfg, {}, deps);
    expect(effects).toEqual(["simulate", "publish rejected"]);
    expect(result).toMatchObject({ kind: "rejected", rejection: { stage: "simulation", error: "TradeTooLarge" } });
    expect(published[0]!.record).toMatchObject({
      kind: "rejected",
      action: { side: "sell" },
      rejection: {
        stage: "simulation",
        error: refusal.name,
        detail: refusal.detail,
        replay: { block: Number(BLOCK), from: AGENT_ADDRESS, reasoningHash: SIMULATION_REASONING_HASH, sequence: 8 },
      },
    });
  });

  it("follows a reverted trade with a rejection that points at the trade record", async () => {
    const { deps, effects, published, cfg } = setup({
      deps: {
        execute: async () => {
          effects.push("execute");
          return { ok: false, txHash: TX_HASH, error: { name: "Error", detail: "Too little received" } };
        },
      },
    });
    const result = await tick(cfg, {}, deps);
    expect(effects).toEqual(["simulate", "publish trade", "execute", "publish rejected"]);
    expect(published[1]!.record).toMatchObject({
      kind: "rejected",
      rationale: "Execution of decision 42 failed: Error.",
      rejection: {
        stage: "execution",
        error: "Error",
        detail: "Too little received",
        decisionSeq: 42,
        txHash: TX_HASH,
      },
    });
    expect(result).toMatchObject({ kind: "rejected", hcs: { sequence: 43 }, rejection: { stage: "execution" } });
  });

  it.each([
    ["another agent", vaultState({ agent: "0x000000000000000000000000000000000000dEaD" }), /vault's agent is/],
    ["another topic", vaultState({ topicId: "0.0.9", hcsTopicNum: "9" }), /cites decisions from 0\.0\.9/],
  ] as const)("refuses to run against a vault wired to %s", async (_case, state, message) => {
    const { fakes, deps, cfg } = setup({ state });
    await expect(tick(cfg, {}, deps)).rejects.toThrow(SetupMismatchError);
    await expect(tick(cfg, {}, deps)).rejects.toThrow(message);
    expect(fakes.publish).not.toHaveBeenCalled();
  });

  it("reports each step", async () => {
    const { deps, cfg } = setup();
    const steps: string[] = [];
    await tick(cfg, { onStep: step => steps.push(step.step) }, deps);
    expect(steps).toEqual(["market", "vault", "decision", "pool", "simulate", "publish", "execute"]);
  });
});
