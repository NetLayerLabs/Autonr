import { type AgentConfig } from "../config";
import { manualStrategy } from "./manual";
import { rebalanceStrategy } from "./rebalance";
import { type ManualAction, type Strategy } from "./types";

/**
 * The strategy for this tick: a manual action when one is given, otherwise the configured strategy. The LLM strategy
 * is imported on demand, so the AI SDK is only loaded when AUTONR_STRATEGY=llm (including inside the Next.js server).
 */
export async function loadStrategy(cfg: AgentConfig, manual?: ManualAction): Promise<Strategy> {
  if (manual) return manualStrategy(manual);
  if (cfg.strategy === "llm") {
    if (!cfg.llm) throw new Error("AUTONR_STRATEGY=llm needs ANTHROPIC_API_KEY");
    const { llmStrategy } = await import("./llm");
    return llmStrategy(cfg.llm);
  }
  return rebalanceStrategy;
}
