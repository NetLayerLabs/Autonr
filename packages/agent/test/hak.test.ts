import {
  AbstractHook,
  AgentMode,
  type Context,
  type PreToolExecutionParams,
  type Tool,
} from "@hashgraph/hedera-agent-kit";
import { type Client, LedgerId } from "@hiero-ledger/sdk";
import { type Hex, HttpRequestError } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type TickOptions, type TickResult } from "../src/agent/tick";
import { MAX_MODEL_LENGTH } from "../src/decision";
import {
  type AutonrHakDeps,
  autonrPlugin,
  type AutonrPluginOptions,
  autonrToolNames,
  hederaAiSdkTools,
  proposeTradeInput,
  verifyTradeInput,
} from "../src/hak";
import { type PoolHealth } from "../src/saucerswap";
import { manualStrategy } from "../src/strategy/manual";
import { type TradeProof } from "../src/verify";
import { agentConfig, marketSnapshot, TOPIC_ID, vaultState } from "./fixtures";

const TX_HASH: Hex = `0x${"ab".repeat(32)}`;
const RATIONALE = "WHBAR is 84% of the vault against a 50% target; selling $5 moves it back.";

const cfg = agentConfig();
const health: PoolHealth = {
  pool: "0x0000000000000000000000000000000000000abc",
  poolPriceUsd: 0.1025,
  oraclePriceUsd: 0.10245,
  deviationBps: 5,
  buyAccepted: true,
  sellAccepted: true,
  detail: "Pool prices WHBAR at $0.1025 vs oracle $0.10245 (+5 bps).",
};

function tradeResult(opts: TickOptions): TickResult {
  return {
    kind: "trade",
    dryRun: opts.dryRun ?? false,
    durationMs: 1200,
    decision: { kind: "trade", rationale: opts.manual?.rationale ?? "" } as TickResult["decision"],
    hcs: { topicId: TOPIC_ID, sequence: 8, consensusTimestamp: "1790000001.000000001", transactionId: "0.0.5004@1" },
    trade: { txHash: TX_HASH, tradeId: 4, amountIn: "4880000000", amountOut: "4990000", hashscanUrl: "https://x" },
  };
}

/** The plugin wired to fakes: no network, no keys. */
function setup(options: Omit<AutonrPluginOptions, "deps"> = {}, overrides: Partial<AutonrHakDeps> = {}) {
  const deps = {
    readOnlyConfig: vi.fn(() => cfg),
    agentConfig: vi.fn(() => cfg),
    snapshot: vi.fn(async () => marketSnapshot()),
    poolHealth: vi.fn(async () => health),
    vaultState: vi.fn(async () => vaultState()),
    runTick: vi.fn(async (_cfg, opts: TickOptions) => tradeResult(opts)),
    verifyTrade: vi.fn(
      async () =>
        ({
          tradeId: 4,
          verdict: "verified",
          checks: [{ id: "x", title: "Decision first", status: "pass", detail: "ok" }],
          links: { tx: "https://hashscan.io/testnet/transaction/x" },
        }) as unknown as TradeProof,
    ),
    ...overrides,
  } satisfies AutonrHakDeps;
  const tools = autonrPlugin({ ...options, deps }).tools({});
  const byMethod = (method: string): Tool => {
    const found = tools.find(tool => tool.method === method);
    if (!found) throw new Error(`no tool ${method}`);
    return found;
  };
  const run = (method: string, params: unknown, context: Context = {}) =>
    byMethod(method).execute({} as Client, context, params) as Promise<{
      raw: Record<string, unknown>;
      humanMessage: string;
    }>;
  return { deps, tools, run };
}

beforeEach(() => {
  // BaseTool logs every failure it turns into an ERROR result.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("autonr HAK plugin", () => {
  it("exposes four tools, only one of which can trade", () => {
    const { tools } = setup();
    expect(tools.map(tool => [tool.method, tool.toolType])).toEqual([
      [autonrToolNames.MARKET_SNAPSHOT, "query"],
      [autonrToolNames.VAULT_STATE, "query"],
      [autonrToolNames.PROPOSE_TRADE, "transaction"],
      [autonrToolNames.VERIFY_TRADE, "query"],
    ]);
  });

  it("lets the model choose a side, a size and reasons, never a price", () => {
    const schema = z.toJSONSchema(proposeTradeInput) as { properties: object; additionalProperties: boolean };
    expect(Object.keys(schema.properties)).toEqual(["side", "usd", "rationale"]);
    expect(schema.additionalProperties).toBe(false);

    const valid = { side: "sell", usd: 5, rationale: RATIONALE };
    expect(proposeTradeInput.safeParse(valid).success).toBe(true);
    for (const bad of [
      { ...valid, price: 0.2 },
      { ...valid, minAmountOut: "1" },
      { ...valid, usd: 0 },
      { ...valid, usd: -5 },
      { ...valid, side: "withdraw" },
      { ...valid, rationale: "  " },
      { ...valid, rationale: "x".repeat(401) },
      { side: "buy", usd: 5 },
    ]) {
      expect(proposeTradeInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(verifyTradeInput.safeParse({ tx: TX_HASH }).success).toBe(true);
    expect(verifyTradeInput.safeParse({}).success).toBe(false);
  });

  it("proposes through runTick with a manual action carrying the model's reasons", async () => {
    const onStep = vi.fn();
    const { deps, run } = setup({ model: "hak/claude-sonnet-5-5", dryRun: true, onStep });
    const result = await run(autonrToolNames.PROPOSE_TRADE, { side: "sell", usd: 5, rationale: ` ${RATIONALE} ` });

    expect(deps.runTick).toHaveBeenCalledTimes(1);
    expect(deps.runTick).toHaveBeenCalledWith(cfg, {
      dryRun: true,
      manual: { side: "sell", usd: 5, rationale: RATIONALE, source: "hak", model: "hak/claude-sonnet-5-5" },
      onStep,
    });
    expect(result.raw).toMatchObject({ status: "SUCCESS", kind: "trade", hcs: { sequence: 8 }, trade: { tradeId: 4 } });
    expect(result.humanMessage).toContain(RATIONALE);
    expect(result.humanMessage).toContain(`${autonrToolNames.VERIFY_TRADE} with tx ${TX_HASH}`);
  });

  it("refuses invalid input before anything runs", async () => {
    const { deps, run } = setup();
    const result = await run(autonrToolNames.PROPOSE_TRADE, { side: "buy", usd: 5, rationale: "x", price: 1 });
    expect(result.raw.status).toBe("ERROR");
    expect(String(result.raw.error)).toContain("invalid input");
    expect(deps.runTick).not.toHaveBeenCalled();
  });

  it("refuses to trade when the host expects unsigned bytes or acts for another account", async () => {
    const { deps, run } = setup();
    const params = { side: "buy", usd: 5, rationale: RATIONALE };
    const bytes = await run(autonrToolNames.PROPOSE_TRADE, params, { mode: AgentMode.RETURN_BYTES });
    const stranger = await run(autonrToolNames.PROPOSE_TRADE, params, { accountId: "0.0.999" });
    expect(bytes.raw.status).toBe("ERROR");
    expect(String(bytes.raw.error)).toContain("autonomous");
    expect(stranger.raw.status).toBe("ERROR");
    expect(String(stranger.raw.error)).toContain("not the vault's agent 0.0.5004");
    expect(deps.runTick).not.toHaveBeenCalled();

    await run(autonrToolNames.PROPOSE_TRADE, params, { accountId: "0.0.5004", mode: AgentMode.AUTONOMOUS });
    expect(deps.runTick).toHaveBeenCalledTimes(1);
  });

  it("runs the host's HAK hooks first, so a policy can block a trade before it is published", async () => {
    class NoTrades extends AbstractHook {
      name = "no trades";
      description = "blocks every trade";
      relevantTools = [autonrToolNames.PROPOSE_TRADE];
      override async preToolExecutionHook(_params: PreToolExecutionParams, method: string): Promise<void> {
        if (this.appliesToMethod(method)) throw new Error("blocked by policy");
      }
    }
    const { deps, run } = setup();
    const result = await run(
      autonrToolNames.PROPOSE_TRADE,
      { side: "buy", usd: 5, rationale: RATIONALE },
      { hooks: [new NoTrades()] },
    );
    expect(String(result.raw.error)).toContain("blocked by policy");
    expect(deps.runTick).not.toHaveBeenCalled();
  });

  it("reads the oracles and the pool for the market snapshot", async () => {
    const { deps, run } = setup();
    const result = await run(autonrToolNames.MARKET_SNAPSHOT, {});
    expect(deps.snapshot).toHaveBeenCalledWith(cfg);
    expect(deps.poolHealth).toHaveBeenCalledWith(cfg, marketSnapshot());
    expect(result.raw).toMatchObject({ status: "SUCCESS", pair: "WHBAR/USDC", pool: health });
    expect(result.humanMessage).toContain("Supra 81 bps apart");
    expect(result.humanMessage).toContain(health.detail);
  });

  it("values the vault's holdings at the oracle prices", async () => {
    const { deps, run } = setup();
    const result = await run(autonrToolNames.VAULT_STATE, {});
    expect(deps.vaultState).toHaveBeenCalledWith(cfg);
    expect(result.raw).toMatchObject({ status: "SUCCESS", vault: vaultState() });
    expect((result.raw.portfolio as { baseWeight: number }).baseWeight).toBeCloseTo(51.225 / 61.2247, 3);
    expect(result.humanMessage).toContain("$40.00 left of the $50.00 daily cap");
  });

  it("reports a missing vault as an error", async () => {
    const { run } = setup({}, { vaultState: vi.fn(async () => null) });
    const result = await run(autonrToolNames.VAULT_STATE, {});
    expect(result.raw.status).toBe("ERROR");
  });

  it("hides the RPC and Mirror Node URLs in an error shown to the model", async () => {
    const failure = new HttpRequestError({ url: cfg.rpcUrl, details: "connection refused" });
    const { run } = setup({}, { snapshot: vi.fn(async () => Promise.reject(failure)) });
    const result = await run(autonrToolNames.MARKET_SNAPSHOT, {});
    expect(result.raw.status).toBe("ERROR");
    expect(result.humanMessage).toContain(
      "Autonr market snapshot failed: the JSON-RPC relay at [HEDERA_RPC_URL] failed",
    );
    expect(result.humanMessage).toContain("connection refused");
    for (const text of [result.humanMessage, String(result.raw.error)]) expect(text).not.toContain(cfg.rpcUrl);
  });

  it("refuses a model name the decision record cannot hold", () => {
    expect(() => autonrPlugin({ model: "m".repeat(MAX_MODEL_LENGTH) })).not.toThrow();
    expect(() => autonrPlugin({ model: "m".repeat(MAX_MODEL_LENGTH + 1) })).toThrow(RangeError);
  });

  it("verifies a trade with the configured network and Mirror Node", async () => {
    const { deps, run } = setup();
    const result = await run(autonrToolNames.VERIFY_TRADE, { tx: TX_HASH });
    expect(deps.verifyTrade).toHaveBeenCalledWith({ network: "testnet", tx: TX_HASH, mirrorUrl: cfg.mirrorUrl });
    expect(result.humanMessage).toContain("Trade #4: VERIFIED.");
  });
});

describe("hederaAiSdkTools", () => {
  it("turns the plugin into AI SDK tools that run through HederaAgentAPI", async () => {
    const { deps } = setup();
    const client = { ledgerId: LedgerId.TESTNET } as unknown as Client;
    const tools = hederaAiSdkTools(client, {
      plugins: [autonrPlugin({ deps })],
      tools: [autonrToolNames.MARKET_SNAPSHOT, autonrToolNames.PROPOSE_TRADE],
    });
    expect(Object.keys(tools)).toEqual([autonrToolNames.MARKET_SNAPSHOT, autonrToolNames.PROPOSE_TRADE]);

    const propose = tools[autonrToolNames.PROPOSE_TRADE];
    const output = await propose?.execute?.(
      { side: "buy", usd: 2, rationale: RATIONALE },
      { toolCallId: "call-1", messages: [] },
    );
    expect(output).toMatchObject({ raw: { status: "SUCCESS", kind: "trade" } });
    expect(deps.runTick).toHaveBeenCalledWith(
      cfg,
      expect.objectContaining({ manual: expect.objectContaining({ usd: 2 }) }),
    );
  });
});

describe("manualStrategy", () => {
  it("publishes a caller's rationale and model, and keeps the operator default otherwise", async () => {
    const input = { cfg, snapshot: marketSnapshot(), state: vaultState() };
    const fromAgent = await manualStrategy({ side: "sell", usd: 5, rationale: RATIONALE, model: "hak/x" }).decide(
      input,
    );
    expect(fromAgent).toMatchObject({ kind: "trade", rationale: RATIONALE, model: "hak/x" });
    const fromOperator = await manualStrategy({ side: "sell", usd: 5 }).decide(input);
    expect(fromOperator).toEqual({
      kind: "trade",
      side: "sell",
      usd: 5,
      rationale: "Operator requested a sell of $5.00 of WHBAR.",
    });
  });
});
