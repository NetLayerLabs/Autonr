import { describe, expect, it } from "vitest";
import { decideRebalance, MIN_TRADE_USD, REBALANCE_BAND } from "../src/strategy/rebalance";
import { type StrategyDecision } from "../src/strategy/types";
import { agentConfig, marketSnapshot, vaultState } from "./fixtures";

const E18 = 10n ** 18n;
/** At the fixture prices: 1 WHBAR = $0.10245, 1 USDC = $0.99997. */
const whbar = (amount: number) => BigInt(Math.round(amount * 1e8));
const usdc = (amount: number) => BigInt(Math.round(amount * 1e6));

type Case = {
  name: string;
  base: bigint;
  quote: bigint;
  tradeUsd?: number;
  maxTradeUsd?: bigint;
  remainingDailyUsd?: bigint;
  expected: Pick<StrategyDecision, "kind"> & { side?: "buy" | "sell"; usd?: number; mentions: string };
};

const cases: Case[] = [
  { name: "an empty vault", base: 0n, quote: 0n, expected: { kind: "hold", mentions: "nothing to rebalance" } },
  {
    name: "a weight inside the band",
    base: whbar(520),
    quote: usdc(50),
    expected: { kind: "hold", mentions: "within the 5.0% band" },
  },
  {
    name: "too much WHBAR, sized by the configured trade size",
    base: whbar(800),
    quote: usdc(20),
    expected: { kind: "trade", side: "sell", usd: 5, mentions: "configured trade size" },
  },
  {
    name: "too little WHBAR",
    base: whbar(100),
    quote: usdc(80),
    expected: { kind: "trade", side: "buy", usd: 5, mentions: "buy $5.00 of WHBAR" },
  },
  {
    name: "a per-trade cap below the configured size",
    base: whbar(800),
    quote: usdc(20),
    maxTradeUsd: 2n * E18,
    expected: { kind: "trade", side: "sell", usd: 2, mentions: "per-trade cap" },
  },
  {
    name: "a drift worth less than the configured size",
    base: whbar(95),
    quote: usdc(7.6),
    expected: { kind: "trade", side: "sell", usd: 1.06, mentions: "sized by the gap to the target" },
  },
  {
    name: "a daily cap nearly used up",
    base: whbar(800),
    quote: usdc(20),
    remainingDailyUsd: E18 / 2n,
    expected: { kind: "hold", mentions: "below the $1.00 minimum" },
  },
];

describe("rebalance strategy", () => {
  it("exports its thresholds", () => {
    expect(REBALANCE_BAND).toBe(0.05);
    expect(MIN_TRADE_USD).toBe(1);
  });

  it.each(cases.map(c => [c.name, c] as const))("%s", (_name, c) => {
    const state = vaultState(
      {
        policy: { ...vaultState().policy, ...(c.maxTradeUsd ? { maxTradeUsd: c.maxTradeUsd.toString() } : {}) },
        ...(c.remainingDailyUsd !== undefined ? { remainingDailyUsd: c.remainingDailyUsd.toString() } : {}),
      },
      { base: c.base, quote: c.quote },
    );
    const decision = decideRebalance({
      snapshot: marketSnapshot(),
      state,
      cfg: agentConfig({ tradeUsd: c.tradeUsd ?? 5 }),
    });
    expect(decision.kind).toBe(c.expected.kind);
    expect(decision.rationale).toContain(c.expected.mentions);
    if (decision.kind === "trade") {
      expect(decision.side).toBe(c.expected.side);
      expect(decision.usd).toBe(c.expected.usd);
    }
  });

  it("states the numbers it decided on", () => {
    const decision = decideRebalance({
      snapshot: marketSnapshot(),
      state: vaultState({}, { base: whbar(800), quote: usdc(20) }),
      cfg: agentConfig(),
    });
    expect(decision.rationale).toBe(
      "WHBAR is 80.4% of $101.96 (target 50.0%): sell $5.00 of WHBAR, sized by the configured trade size.",
    );
  });
});
