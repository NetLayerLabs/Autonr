import { formatUsd } from "../oracles/math";
import { type ManualAction, type Strategy } from "./types";

/** A trade the operator or an external agent asked for (CLI flags, the tick API, the HAK plugin). The vault still prices and polices it. */
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
      rationale:
        action.rationale?.trim() ||
        `Operator requested a ${action.side} of ${formatUsd(action.usd)} of ${cfg.baseToken.symbol}.`,
      ...(action.model ? { model: action.model } : {}),
    }),
  };
}
