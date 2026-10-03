import { type AgentConfig } from "../config";
import { type MarketSnapshot } from "../oracles/snapshot";
import { type VaultState } from "../vault/read";

export type StrategyId = "rebalance" | "llm" | "manual";
/** What decision records name as their strategy: a configurable strategy, or "hak" for Hedera Agent Kit requests. */
export type DecisionSource = StrategyId | "hak";

/**
 * A trade asked for explicitly, in USD; `buy` spends the quote token to get the base token. A caller that decided on
 * its own (an external agent, e.g. through the Hedera Agent Kit plugin) passes its `rationale`, published verbatim,
 * and the `model` that decided. It never passes a price: the vault prices the trade with its oracles.
 * `source` names who asked, which becomes the decision record's strategy id ("manual" when an operator asked).
 */
export type ManualAction = { side: "buy" | "sell"; usd: number; rationale?: string; model?: string; source?: "hak" };

export type StrategyInput = { snapshot: MarketSnapshot; state: VaultState; cfg: AgentConfig };

/**
 * What a strategy wants, before any guardrail. The tick turns `usd` into a token amount with the oracle price, and
 * the vault later re-prices it and applies the policy, so a strategy never has to be trusted with either.
 * `model` names the model that actually answered, which the decision log records.
 */
export type StrategyDecision = (
  | { kind: "hold"; rationale: string }
  | { kind: "trade"; side: "buy" | "sell"; usd: number; rationale: string }
) & { model?: string };

export type Strategy = {
  id: DecisionSource;
  /** Bumped whenever the decision logic changes, so published decisions say which logic produced them. */
  version: string;
  decide(input: StrategyInput): Promise<StrategyDecision>;
};
