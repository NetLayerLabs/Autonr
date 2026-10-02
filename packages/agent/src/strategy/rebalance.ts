import { e18ToNumber, formatUsd } from "../oracles/math";
import { portfolioOf } from "./portfolio";
import { type Strategy, type StrategyDecision, type StrategyInput } from "./types";

/** How far the base token's weight may drift from the target, in weight units, before the strategy trades. */
export const REBALANCE_BAND = 0.05;

/** Trades below this are not worth an HCS message, gas and the pool fee. */
export const MIN_TRADE_USD = 1;

const percent = (weight: number) => `${(weight * 100).toFixed(1)}%`;

/**
 * Keeps the vault near `cfg.targetBaseWeight` of its USD value in the base token. Deterministic and pure: the same
 * snapshot and vault state always give the same decision, which makes every published decision reproducible.
 */
export function decideRebalance({ snapshot, state, cfg }: StrategyInput): StrategyDecision {
  const { base, totalUsd, baseWeight } = portfolioOf(cfg, snapshot, state);
  if (baseWeight === null) return { kind: "hold", rationale: "The vault holds nothing to rebalance." };

  const symbol = base.token.symbol;
  const drift = baseWeight - cfg.targetBaseWeight;
  const position = `${symbol} is ${percent(baseWeight)} of ${formatUsd(totalUsd)} (target ${percent(cfg.targetBaseWeight)})`;
  if (Math.abs(drift) <= REBALANCE_BAND) {
    return { kind: "hold", rationale: `${position}, within the ${percent(REBALANCE_BAND)} band.` };
  }

  const limits: [string, number][] = [
    ["gap to the target", Math.abs(drift) * totalUsd],
    ["configured trade size", cfg.tradeUsd],
    ["vault's per-trade cap", e18ToNumber(BigInt(state.policy.maxTradeUsd))],
    ["vault's remaining daily cap", e18ToNumber(BigInt(state.remainingDailyUsd))],
  ];
  const [limit, limitUsd] = limits.reduce((smallest, entry) => (entry[1] < smallest[1] ? entry : smallest));
  const usd = Math.floor(limitUsd * 100) / 100;
  if (usd < MIN_TRADE_USD) {
    return {
      kind: "hold",
      rationale: `${position}, but the ${limit} allows only ${formatUsd(usd)}, below the ${formatUsd(MIN_TRADE_USD)} minimum.`,
    };
  }
  const side = drift > 0 ? "sell" : "buy";
  return {
    kind: "trade",
    side,
    usd,
    rationale: `${position}: ${side} ${formatUsd(usd)} of ${symbol}, sized by the ${limit}.`,
  };
}

export const rebalanceStrategy: Strategy = {
  id: "rebalance",
  version: "1",
  decide: async input => decideRebalance(input),
};
