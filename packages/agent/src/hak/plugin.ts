import {
  AgentMode,
  BaseTool,
  type Context,
  isCustomMode,
  isReturnBytesMode,
  type Plugin,
  TOOL_TYPE,
  type ToolType,
} from "@hashgraph/hedera-agent-kit";
import { formatUnits } from "viem";
import { tickSummary } from "../agent/log";
import { describeMarket, runTick, type TickOptions, type TickResult, type TickStep } from "../agent/tick";
import { type AgentConfig, loadAgentConfig, loadReadOnlyConfig, type ReadOnlyConfig } from "../config";
import { formatUsd, formatUsdE18 } from "../oracles/math";
import { fetchMarketSnapshot, type MarketSnapshot } from "../oracles/snapshot";
import { type PoolHealth, poolHealth } from "../saucerswap";
import { portfolioOf } from "../strategy/portfolio";
import { readVaultState, type VaultState } from "../vault/read";
import { type TradeProof, verifyTrade } from "../verify";
import { z } from "zod";

/** Tool method names, for `Configuration.tools` filters and hook `relevantTools` lists. */
export const autonrToolNames = {
  MARKET_SNAPSHOT: "autonr_market_snapshot",
  VAULT_STATE: "autonr_vault_state",
  PROPOSE_TRADE: "autonr_propose_trade",
  VERIFY_TRADE: "autonr_verify_trade",
} as const;

/** Longest `strategy.model` the decision schema accepts. */
const MAX_MODEL_LENGTH = 48;
/** Longest rationale the decision schema accepts; it is published verbatim to HCS. */
const MAX_RATIONALE_LENGTH = 400;

/**
 * Everything the tools do to the outside world: the same @sh/agent functions the CLIs and the dashboard use. Tests
 * substitute fakes.
 */
export type AutonrHakDeps = {
  readOnlyConfig(): ReadOnlyConfig;
  agentConfig(): AgentConfig;
  snapshot(cfg: ReadOnlyConfig): Promise<MarketSnapshot>;
  poolHealth(cfg: ReadOnlyConfig, snapshot: MarketSnapshot): Promise<PoolHealth>;
  vaultState(cfg: ReadOnlyConfig): Promise<VaultState | null>;
  runTick(cfg: AgentConfig, opts: TickOptions): Promise<TickResult>;
  verifyTrade(input: { network: ReadOnlyConfig["network"]; tx: string; mirrorUrl?: string }): Promise<TradeProof>;
};

const defaultDeps: AutonrHakDeps = {
  readOnlyConfig: () => loadReadOnlyConfig(),
  agentConfig: () => loadAgentConfig(),
  snapshot: cfg => fetchMarketSnapshot(cfg),
  poolHealth: (cfg, snapshot) => poolHealth(cfg, snapshot),
  vaultState: cfg => readVaultState(cfg),
  runTick: (cfg, opts) => runTick(cfg, opts),
  verifyTrade: input => verifyTrade(input),
};

export type AutonrPluginOptions = {
  /** Decide and simulate only: publish nothing, send nothing. Set by the operator; the model cannot change it. */
  dryRun?: boolean;
  /** Who decided, recorded as `strategy.model` in each decision record (e.g. "hak/claude-sonnet-5-5"). */
  model?: string;
  /** Progress of a proposed trade, one event per tick step. */
  onStep?: (step: TickStep) => void;
  deps?: Partial<AutonrHakDeps>;
};

/** HAK's result envelope: `raw` for programs, `humanMessage` for the model. */
type ToolOutput = { raw: Record<string, unknown>; humanMessage: string };

export const marketSnapshotInput = z.strictObject({});

export const vaultStateInput = z.strictObject({});

/**
 * Direction, size and reasons: nothing else. The schema is strict, so a price, a minimum output or a token address
 * is refused before anything runs; the vault derives all three itself.
 */
export const proposeTradeInput = z.strictObject({
  side: z
    .enum(["buy", "sell"])
    .describe("buy: spend the quote token (e.g. USDC) on the base token (e.g. WHBAR); sell: the reverse"),
  usd: z
    .number()
    .positive()
    .finite()
    .describe("Trade size in US dollars. The vault converts it at its own oracle price and enforces its caps."),
  rationale: z
    .string()
    .trim()
    .min(1)
    .max(MAX_RATIONALE_LENGTH)
    .describe("Why, citing the figures relied on. Published verbatim to the vault's HCS topic before the trade."),
});

export const verifyTradeInput = z.strictObject({
  tx: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("The trade's EVM transaction hash (0x...) or Hedera transaction id (0.0.x@seconds.nanos)"),
});

/**
 * HAK types tool schemas with its own copy of zod 3, but never calls them: `HederaAgentAPI.run` forwards arguments
 * unchecked, and the framework adapters (AI SDK, LangChain, MCP) accept zod 4 schemas such as these. Each tool
 * validates its own input in `normalizeParams`.
 */
function hakParameters(schema: z.ZodObject): BaseTool["parameters"] {
  return schema as unknown as BaseTool["parameters"];
}

type ToolSpec<I extends z.ZodObject> = {
  method: string;
  name: string;
  description: string;
  input: I;
  toolType: ToolType;
};

/**
 * A HAK tool backed by @sh/agent. Extending BaseTool runs the host's hooks and policies (`Context.hooks`) around
 * every call, so a policy can still block a trade before anything is published.
 */
abstract class AutonrTool<I extends z.ZodObject> extends BaseTool<unknown, z.output<I>> {
  readonly method: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: BaseTool["parameters"];
  private readonly input: I;

  constructor(
    spec: ToolSpec<I>,
    protected readonly deps: AutonrHakDeps,
  ) {
    super();
    this.method = spec.method;
    this.name = spec.name;
    this.description = spec.description;
    this.input = spec.input;
    this.parameters = hakParameters(spec.input);
    this.toolType = spec.toolType;
  }

  async normalizeParams(params: unknown): Promise<z.output<I>> {
    const parsed = this.input.safeParse(params ?? {});
    if (parsed.success) return parsed.data;
    const issues = parsed.error.issues.map(issue => `${issue.path.join(".") || "input"}: ${issue.message}`);
    throw new Error(`invalid input (${issues.join("; ")})`);
  }

  /** The result is final: there is no HAK transaction to sign afterwards. */
  override async shouldSecondaryAction(): Promise<boolean> {
    return false;
  }

  abstract override coreAction(params: z.output<I>, context: Context): Promise<ToolOutput>;
}

class MarketSnapshotTool extends AutonrTool<typeof marketSnapshotInput> {
  constructor(deps: AutonrHakDeps) {
    super(
      {
        method: autonrToolNames.MARKET_SNAPSHOT,
        name: "Autonr market snapshot",
        description:
          "Reads the prices the Autonr AgentVault will enforce (Chainlink, cross-checked by Supra) and whether the " +
          "SaucerSwap V2 pool would clear the vault's oracle-derived minimum for a $1 buy and a $1 sell. Read-only.",
        input: marketSnapshotInput,
        toolType: TOOL_TYPE.QUERY,
      },
      deps,
    );
  }

  async coreAction(): Promise<ToolOutput> {
    const cfg = this.deps.readOnlyConfig();
    const snapshot = await this.deps.snapshot(cfg);
    const pool = await this.deps.poolHealth(cfg, snapshot);
    return {
      raw: { network: cfg.network, pair: `${cfg.baseToken.symbol}/${cfg.quoteToken.symbol}`, oracles: snapshot, pool },
      humanMessage: `${describeMarket(snapshot)}. ${pool.detail}`,
    };
  }
}

class VaultStateTool extends AutonrTool<typeof vaultStateInput> {
  constructor(deps: AutonrHakDeps) {
    super(
      {
        method: autonrToolNames.VAULT_STATE,
        name: "Autonr vault state",
        description:
          "Reads the Autonr AgentVault: holdings valued at the oracle prices, the base token's share, the owner's " +
          "policy (max trade, daily cap, cooldown), what is left of today's cap and when the next trade may run. Read-only.",
        input: vaultStateInput,
        toolType: TOOL_TYPE.QUERY,
      },
      deps,
    );
  }

  async coreAction(): Promise<ToolOutput> {
    const cfg = this.deps.readOnlyConfig();
    const [state, snapshot] = await Promise.all([this.deps.vaultState(cfg), this.deps.snapshot(cfg)]);
    if (!state) throw new Error("no vault is configured; set AUTONR_VAULT_ADDRESS");
    const portfolio = portfolioOf(cfg, snapshot, state);
    const holdings = [portfolio.base, portfolio.quote].map(
      h => `${formatUnits(BigInt(h.token.balance), h.token.decimals)} ${h.token.symbol} (${formatUsd(h.usd)})`,
    );
    const weight =
      portfolio.baseWeight === null
        ? "the vault is empty"
        : `${portfolio.base.token.symbol} is ${(portfolio.baseWeight * 100).toFixed(1)}% of ${formatUsd(portfolio.totalUsd)}`;
    const { policy } = state;
    const lines = [
      `Vault ${state.address}${state.paused ? " is PAUSED" : ""}: ${holdings.join(" + ")}; ${weight}.`,
      `Policy: at most ${formatUsdE18(BigInt(policy.maxTradeUsd))} per trade, ` +
        `${formatUsdE18(BigInt(state.remainingDailyUsd))} left of the ${formatUsdE18(BigInt(policy.dailyCapUsd))} daily cap, ` +
        `cooldown ${policy.cooldown} s (next trade from ${new Date(state.nextTradeAt * 1000).toISOString()}).`,
      `${state.tradeCount} trades so far; last decision cited is HCS message ${state.lastReasoningSequence} on ${state.topicId ?? "no topic"}.`,
    ];
    return {
      raw: {
        vault: state,
        portfolio: {
          baseUsd: portfolio.base.usd,
          quoteUsd: portfolio.quote.usd,
          totalUsd: portfolio.totalUsd,
          baseWeight: portfolio.baseWeight,
        },
      },
      humanMessage: lines.join(" "),
    };
  }
}

class ProposeTradeTool extends AutonrTool<typeof proposeTradeInput> {
  constructor(
    deps: AutonrHakDeps,
    private readonly options: AutonrPluginOptions,
  ) {
    super(
      {
        method: autonrToolNames.PROPOSE_TRADE,
        name: "Autonr propose trade",
        description:
          "Proposes a trade to the Autonr AgentVault. You choose only the side, a USD size and a rationale; never a " +
          "price. The agent first checks the vault's preconditions and the pool and simulates the swap, then publishes " +
          "your rationale to the vault's HCS topic, and only then calls executeSwap citing that message. The vault " +
          "prices the trade with Chainlink and Supra, sets the minimum output itself and enforces the owner's caps, so " +
          "a bad proposal is refused or turned into a hold with the reason. Returns trade, hold or rejected.",
        input: proposeTradeInput,
        toolType: TOOL_TYPE.TRANSACTION,
      },
      deps,
    );
  }

  async coreAction(params: z.output<typeof proposeTradeInput>, context: Context): Promise<ToolOutput> {
    // The trade is signed here with the vault's agent key; there are no bytes to hand to an external signer.
    if (isReturnBytesMode(context.mode) || isCustomMode(context.mode)) {
      throw new Error(
        `${this.method} signs with the vault's agent key and runs only in ${AgentMode.AUTONOMOUS} mode, not ${context.mode}`,
      );
    }
    const cfg = this.deps.agentConfig();
    if (context.accountId && context.accountId !== cfg.agentAccountId) {
      throw new Error(
        `the HAK context account ${context.accountId} is not the vault's agent ${cfg.agentAccountId} (AGENT_ACCOUNT_ID)`,
      );
    }
    const result = await this.deps.runTick(cfg, {
      dryRun: this.options.dryRun ?? false,
      manual: {
        side: params.side,
        usd: params.usd,
        rationale: params.rationale,
        source: "hak",
        ...(this.options.model ? { model: this.options.model.slice(0, MAX_MODEL_LENGTH) } : {}),
      },
      onStep: this.options.onStep,
    });
    const { kind, dryRun, decision, hcs, trade, rejection } = result;
    const next = trade ? ` Call ${autonrToolNames.VERIFY_TRADE} with tx ${trade.txHash} to check it.` : "";
    return {
      raw: { kind, dryRun, decision, hcs, trade, rejection },
      humanMessage: `${decision.rationale}\n${tickSummary(cfg, result).join("\n")}${next}`,
    };
  }
}

class VerifyTradeTool extends AutonrTool<typeof verifyTradeInput> {
  constructor(deps: AutonrHakDeps) {
    super(
      {
        method: autonrToolNames.VERIFY_TRADE,
        name: "Autonr verify trade",
        description:
          "Verifies an Autonr trade from public Mirror Node data alone: the HCS decision came first, its hash and " +
          "sequence match what the vault cited, the oracle prices and the policy held. Read-only.",
        input: verifyTradeInput,
        toolType: TOOL_TYPE.QUERY,
      },
      deps,
    );
  }

  async coreAction(params: z.output<typeof verifyTradeInput>): Promise<ToolOutput> {
    const cfg = this.deps.readOnlyConfig();
    const proof = await this.deps.verifyTrade({ network: cfg.network, tx: params.tx, mirrorUrl: cfg.mirrorUrl });
    const notPassed = proof.checks.filter(check => check.status === "fail" || check.status === "skip");
    const details = notPassed.map(check => `${check.status.toUpperCase()} ${check.title}: ${check.detail}`);
    return {
      raw: { proof },
      humanMessage: [`Trade #${proof.tradeId}: ${proof.verdict.toUpperCase()}.`, ...details, proof.links.tx].join("\n"),
    };
  }
}

/**
 * The Autonr plugin for the Hedera Agent Kit. It gives any HAK agent one way to trade: through the AgentVault, with
 * its reasoning on HCS before the swap. HAK's audit-trail hook logs after execution and is best-effort; here the
 * reasoning is a precondition the vault enforces, and a trade without it reverts.
 */
export function autonrPlugin(options: AutonrPluginOptions = {}): Plugin {
  const deps: AutonrHakDeps = { ...defaultDeps, ...options.deps };
  return {
    name: "autonr",
    version: "1.0.0",
    description:
      "Trade only through an Autonr AgentVault on Hedera: oracle-priced, policy-capped swaps on SaucerSwap V2 whose " +
      "reasoning is published to HCS before the trade, and verifiable from Mirror Node data.",
    tools: () => [
      new MarketSnapshotTool(deps),
      new VaultStateTool(deps),
      new ProposeTradeTool(deps, options),
      new VerifyTradeTool(deps),
    ],
  };
}
