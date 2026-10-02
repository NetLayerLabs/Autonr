import { formatUsd } from "../oracles/math";
import { type ManualAction, type Strategy } from "./types";

/** A trade the operator asked for (CLI flags or the tick API). The vault still prices and polices it. */
export function manualStrategy(action: ManualAction): Strategy {
  if (!Number.isFinite(action.usd) || action.usd <= 0) {
    throw new RangeError(`a manual ${action.side} needs a positive USD amount, got ${action.usd}`);
  }
  return {
    id: "manual",
    version: "1",
    decide: async ({ cfg }) => ({
      kind: "trade",
      side: action.side,
      usd: action.usd,
      rationale: `Operator requested a ${action.side} of ${formatUsd(action.usd)} of ${cfg.baseToken.symbol}.`,
    }),
  };
}
