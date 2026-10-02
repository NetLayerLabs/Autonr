import { type Address, formatUnits, type Hex, isAddressEqual, keccak256, toBytes } from "viem";
import { readClient, walletClient } from "../chain";
import { type AgentConfig, scriptCommand } from "../config";
import {
  DECISION_SCHEMA_ID,
  type DecisionKind,
  type DecisionRecord,
  encodeDecisionFitting,
  type EncodedDecision,
  type PriceObservation,
  type Rejection,
  type TradeAction,
} from "../decision";
import { type HederaClient, hederaClient } from "../hcs/client";
import { type Publication, publishDecision } from "../hcs/publish";
import { hashscanUrl } from "../hedera";
import { amountForUsd, BPS, formatUsd, formatUsdPrice, quoteSwap, usdToE18 } from "../oracles/math";
import { fetchMarketSnapshot, type MarketSnapshot, type OracleSnapshot } from "../oracles/snapshot";
import { type PoolQuote, quotePool } from "../saucerswap";
import { loadStrategy } from "../strategy";
import { type Holding, type Portfolio, portfolioOf } from "../strategy/portfolio";
import { type ManualAction, type Strategy, type StrategyDecision } from "../strategy/types";
import { revertDataOf, type VaultError } from "../vault/errors";
import { type ExecutionResult, executeSwap } from "../vault/execute";
import { readVaultState, type VaultState } from "../vault/read";
import { type SimulationResult, simulateSwap, type SwapCall } from "../vault/simulate";

export type TickResult = {
  kind: "trade" | "hold" | "rejected";
  decision: DecisionRecord;
  hcs?: Publication;
  trade?: { txHash: Hex; tradeId: number; amountIn: string; amountOut: string; hashscanUrl: string };
  rejection?: { stage: "simulation" | "execution"; error: string; detail: string };
  dryRun: boolean;
  durationMs: number;
};

type TickStepName = "market" | "vault" | "decision" | "pool" | "simulate" | "publish" | "execute";
export type TickStep = { step: TickStepName; detail: string };

export type TickOptions = {
  /** Decide and simulate, but publish nothing and send nothing. */
  dryRun?: boolean;
  manual?: ManualAction;
  /** Progress, one event per step, for CLIs and logs. */
  onStep?: (step: TickStep) => void;
};

/** Everything a tick does to the outside world. Tests substitute fakes; `runTick` wires the real network. */
export type TickDeps = {
  snapshot(): Promise<MarketSnapshot>;
  vaultState(): Promise<VaultState>;
  strategy(): Promise<Strategy>;
  poolQuote(args: { tokenIn: Address; tokenOut: Address; fee: number; amountIn: bigint }): Promise<PoolQuote>;
  blockNumber(): Promise<bigint>;
  simulate(call: SwapCall, blockNumber: bigint): Promise<SimulationResult>;
  execute(call: SwapCall): Promise<ExecutionResult>;
  publish(decision: EncodedDecision): Promise<Publication>;
  now(): Date;
};

/** The agent and the vault disagree about who trades or where decisions go; the owner has to fix it first. */
export class SetupMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupMismatchError";
  }
}

/**
 * Reasoning hash for simulations. Any non-zero hash passes the vault's checks; a fixed, recognisable one lets anyone
 * replay a refused simulation byte for byte.
 */
export const SIMULATION_REASONING_HASH = keccak256(toBytes("autonr:simulation"));

/** Limits of the rejection fields in the decision schema; router messages can be longer. */
const MAX_ERROR_LENGTH = 64;
const MAX_DETAIL_LENGTH = 200;

/**
 * A trade executes some seconds after the snapshot (HCS consensus, then the swap's own transaction), so a price this
 * close to the vault's age limit would be stale by then. Holding avoids publishing a trade that is bound to revert.
 */
const EXECUTION_MARGIN_SECONDS = 30;

/** One agent cycle against the live network. */
export async function runTick(cfg: AgentConfig, opts: TickOptions = {}): Promise<TickResult> {
  const client = readClient(cfg);
  // Created on first publish: a dry run or an early hold that is not logged never opens a gRPC connection.
  const hedera: { client?: HederaClient } = {};
  const deps: TickDeps = {
    snapshot: () => fetchMarketSnapshot(cfg),
    vaultState: () => readVaultState(cfg),
    strategy: () => loadStrategy(cfg, opts.manual),
    poolQuote: args => quotePool(cfg, args),
    blockNumber: () => client.getBlockNumber(),
    simulate: (call, blockNumber) => simulateSwap(client, call, cfg.agentAddress, blockNumber),
    execute: call => executeSwap(client, walletClient(cfg, cfg.agentPrivateKey), call, cfg.mirrorUrl),
    publish: decision => {
      hedera.client ??= hederaClient(cfg.network, cfg.agentAccountId, cfg.agentPrivateKey);
      return publishDecision(hedera.client, cfg.topicId, decision);
    },
    now: () => new Date(),
  };
  try {
    return await tick(cfg, opts, deps);
  } finally {
    hedera.client?.close();
  }
}

/**
 * One agent cycle: check the vault's preconditions, ask the strategy, check the pool, simulate at a pinned block,
 * publish the reasoning to HCS, then trade. The record reaches consensus before the transaction that cites it is
 * signed. Every outcome is a DecisionRecord; a failure that leaves the outcome unknown throws instead.
 */
export async function tick(cfg: AgentConfig, opts: TickOptions, deps: TickDeps): Promise<TickResult> {
  const startedAt = performance.now();
  const [snapshot, state, strategy] = await Promise.all([deps.snapshot(), deps.vaultState(), deps.strategy()]);
  const run = new TickRun(cfg, opts, deps, strategy, snapshot, startedAt);
  run.emit("market", describeMarket(snapshot));
  assertWiring(cfg, state);
  const portfolio = portfolioOf(cfg, snapshot, state);
  run.emit("vault", describeVault(portfolio, state, cfg));

  // Waiting out the cooldown is not a decision, so nothing is published: logging it would only spend HBAR on noise.
  // fetchedAt is chain time, which trails the wall clock by a few seconds; the vault enforces the same clock.
  if (snapshot.fetchedAt < state.nextTradeAt) {
    return run.hold(`The vault's cooldown ends in ${state.nextTradeAt - snapshot.fetchedAt} s.`, undefined, false);
  }
  const refusal = vaultWouldRefuse(cfg, snapshot, state);
  if (refusal) return run.hold(refusal);

  const decision = await strategy.decide({ snapshot, state, cfg });
  if (decision.kind === "hold") return run.hold(decision.rationale, decision.model);
  run.emit("decision", `${decision.side} ${formatUsd(decision.usd)} of ${cfg.baseToken.symbol}: ${decision.rationale}`);
  const overruled = (problem: string) => run.hold(`${problem} ${describeWish(decision)}`, decision.model);

  const legs: Legs =
    decision.side === "buy"
      ? { sell: portfolio.quote, buy: portfolio.base }
      : { sell: portfolio.base, buy: portfolio.quote };
  const amountIn = amountForUsd(usdToE18(decision.usd), BigInt(legs.sell.oracle.priceE18), legs.sell.token.decimals);
  if (amountIn === 0n) return overruled(`The trade is too small to express in ${legs.sell.token.symbol}.`);
  if (amountIn > BigInt(legs.sell.token.balance)) {
    return overruled(`The vault holds only ${formatBalance(legs.sell)} (${formatUsd(legs.sell.usd)}).`);
  }
  const poolProblem = await run.checkPool(state, legs, amountIn);
  if (poolProblem) return overruled(poolProblem);

  const action: TradeAction = {
    side: decision.side,
    tokenIn: legs.sell.token.address,
    tokenOut: legs.buy.token.address,
    amountIn: amountIn.toString(),
    poolFee: state.poolFee,
    usd: decision.usd.toFixed(2),
  };
  const nextSequence = state.lastReasoningSequence + 1;
  const call: SwapCall = {
    vault: cfg.vaultAddress,
    request: { tokenIn: legs.sell.token.address, tokenOut: legs.buy.token.address, poolFee: state.poolFee, amountIn },
    reasoning: { hash: SIMULATION_REASONING_HASH, sequence: BigInt(nextSequence) },
  };
  const blockNumber = await deps.blockNumber();
  const simulated = await deps.simulate(call, blockNumber);
  if (!simulated.ok) {
    run.emit("simulate", `vault refuses at block ${blockNumber}: ${simulated.error.name} (${simulated.error.detail})`);
    return run.reject({ rationale: decision.rationale, model: decision.model }, action, {
      stage: "simulation",
      ...rejectionError(simulated.error),
      replay: {
        block: Number(blockNumber),
        from: cfg.agentAddress,
        reasoningHash: SIMULATION_REASONING_HASH,
        sequence: nextSequence,
      },
    });
  }
  run.emit("simulate", `vault accepts at block ${blockNumber}: ${formatAmount(simulated.amountOut, legs.buy)} out`);

  const tradeRecord = encodeDecisionFitting(
    run.record("trade", { rationale: decision.rationale, model: decision.model, action }),
  );
  if (run.dryRun) return run.finish({ kind: "trade", decision: tradeRecord.record });
  const hcs = await run.publish(tradeRecord);

  const executed = await deps.execute({
    ...call,
    reasoning: { hash: tradeRecord.hash, sequence: BigInt(hcs.sequence) },
  });
  if (!executed.ok) {
    run.emit("execute", `reverted: ${executed.error.name} (${executed.error.detail})`);
    // Every published trade record gets an outcome: its TradeExecuted event, or this follow-up.
    return run.reject(
      { rationale: `Execution of decision ${hcs.sequence} failed: ${executed.error.name}.`, model: decision.model },
      action,
      {
        stage: "execution",
        ...rejectionError(executed.error),
        decisionSeq: hcs.sequence,
        ...(executed.txHash ? { txHash: executed.txHash } : {}),
      },
    );
  }
  run.emit(
    "execute",
    `trade ${executed.tradeId}: ${formatAmount(executed.amountIn, legs.sell)} -> ${formatAmount(executed.amountOut, legs.buy)} in ${executed.txHash}`,
  );
  return run.finish({
    kind: "trade",
    decision: tradeRecord.record,
    hcs,
    trade: {
      txHash: executed.txHash,
      tradeId: executed.tradeId,
      amountIn: executed.amountIn.toString(),
      amountOut: executed.amountOut.toString(),
      hashscanUrl: hashscanUrl(cfg.network, "transaction", executed.txHash),
    },
  });
}

type RecordFields = { rationale: string; model?: string; action?: TradeAction; rejection?: Rejection };

type Legs = { sell: Holding; buy: Holding };

/** The state shared by the steps of one tick: how records are built, published and reported. */
class TickRun {
  readonly dryRun: boolean;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly opts: TickOptions,
    private readonly deps: TickDeps,
    private readonly strategy: Strategy,
    private readonly snapshot: MarketSnapshot,
    private readonly startedAt: number,
  ) {
    this.dryRun = opts.dryRun ?? false;
  }

  emit(step: TickStepName, detail: string): void {
    this.opts.onStep?.({ step, detail });
  }

  record(kind: DecisionKind, fields: RecordFields): DecisionRecord {
    return {
      schema: DECISION_SCHEMA_ID,
      kind,
      network: this.cfg.network,
      vault: this.cfg.vaultAddress,
      agent: this.cfg.agentAccountId,
      createdAt: this.deps.now().toISOString(),
      strategy: {
        id: this.strategy.id,
        version: this.strategy.version,
        ...(fields.model ? { model: fields.model } : {}),
      },
      market: [observation(this.snapshot.base), observation(this.snapshot.quote)],
      rationale: fields.rationale,
      ...(fields.action ? { action: fields.action } : {}),
      ...(fields.rejection ? { rejection: fields.rejection } : {}),
    };
  }

  async publish(encoded: EncodedDecision): Promise<Publication> {
    const hcs = await this.deps.publish(encoded);
    this.emit("publish", `${encoded.record.kind} record is message ${hcs.sequence} on topic ${hcs.topicId}`);
    return hcs;
  }

  finish(result: Omit<TickResult, "dryRun" | "durationMs">): TickResult {
    return { ...result, dryRun: this.dryRun, durationMs: Math.round(performance.now() - this.startedAt) };
  }

  /**
   * Asks SaucerSwap what the swap would pay and compares it with the minimum the vault derives from the oracles. A pool
   * priced away from the oracles makes the vault revert however sound the decision, so the agent explains the hold
   * instead. Returns the reason to hold, or null when the pool would clear the vault's minimum.
   */
  async checkPool(state: VaultState, legs: Legs, amountIn: bigint): Promise<string | null> {
    const fair = quoteSwap({
      amountIn,
      decimalsIn: legs.sell.token.decimals,
      priceInE18: BigInt(legs.sell.oracle.priceE18),
      decimalsOut: legs.buy.token.decimals,
      priceOutE18: BigInt(legs.buy.oracle.priceE18),
      maxSlippageBps: state.policy.maxSlippageBps,
    });
    if (fair.minAmountOut === 0n) return "The trade is too small for the vault to price.";

    let quote: PoolQuote;
    try {
      quote = await this.deps.poolQuote({
        tokenIn: legs.sell.token.address,
        tokenOut: legs.buy.token.address,
        fee: state.poolFee,
        amountIn,
      });
    } catch (error) {
      if (revertDataOf(error) === undefined) throw error;
      return `SaucerSwap cannot quote ${legs.sell.token.symbol} for ${legs.buy.token.symbol} at fee tier ${state.poolFee}: no usable pool.`;
    }
    const estimated = quote.source === "spot";
    const paid = `${estimated ? "about " : ""}${formatAmount(quote.amountOut, legs.buy)}`;
    const basis = estimated ? " at its spot price, as no quoter answered" : "";
    const minimum = formatAmount(fair.minAmountOut, legs.buy);
    this.emit("pool", `SaucerSwap pays ${paid}${basis}; the vault's minimum is ${minimum}`);
    if (quote.amountOut >= fair.minAmountOut) return null;
    const offBps = ((fair.expectedOut - quote.amountOut) * BPS) / fair.expectedOut;
    return (
      `SaucerSwap pool is ${offBps} bps off the oracle; the vault would refuse ` +
      `(it pays ${paid}${basis}, the minimum is ${minimum}).`
    );
  }

  /** Holds are published only when the operator wants them in the log and the hold is a decision worth recording. */
  async hold(rationale: string, model?: string, publish = true): Promise<TickResult> {
    const encoded = encodeDecisionFitting(this.record("hold", { rationale, model }));
    this.emit("decision", `hold: ${encoded.record.rationale}`);
    const hcs = publish && this.cfg.logHolds && !this.dryRun ? await this.publish(encoded) : undefined;
    return this.finish({ kind: "hold", decision: encoded.record, hcs });
  }

  /** Refusals are always published: they are the evidence that the guardrails work. */
  async reject(
    fields: { rationale: string; model?: string },
    action: TradeAction,
    rejection: Rejection,
  ): Promise<TickResult> {
    const encoded = encodeDecisionFitting(this.record("rejected", { ...fields, action, rejection }));
    const hcs = this.dryRun ? undefined : await this.publish(encoded);
    const { stage, error, detail } = rejection;
    return this.finish({ kind: "rejected", decision: encoded.record, hcs, rejection: { stage, error, detail } });
  }
}

/**
 * Refuses to trade when the vault cannot accept this agent's trades: every call would revert, and decisions published
 * to a topic the vault does not cite could never be matched to its trades.
 */
function assertWiring(cfg: AgentConfig, state: VaultState): void {
  const fix = `the vault owner fixes this with ${scriptCommand("agent:setup")}`;
  if (!isAddressEqual(state.agent, cfg.agentAddress)) {
    throw new SetupMismatchError(
      `the vault's agent is ${state.agent}, but AGENT_PRIVATE_KEY signs as ${cfg.agentAddress}; ${fix}`,
    );
  }
  if (state.topicId !== cfg.topicId) {
    throw new SetupMismatchError(
      `the vault cites decisions from ${state.topicId ?? "no topic"}, but AUTONR_TOPIC_ID is ${cfg.topicId}; ${fix}`,
    );
  }
}

/** The vault's own preconditions, checked first so the agent holds instead of asking for a certain revert. */
function vaultWouldRefuse(cfg: AgentConfig, snapshot: MarketSnapshot, state: VaultState): string | null {
  const { policy } = state;
  if (state.paused) return "The vault is paused by its owner.";
  if (state.poolFee === 0) {
    return `The vault's owner has not approved a SaucerSwap fee tier for ${cfg.baseToken.symbol}/${cfg.quoteToken.symbol}.`;
  }
  for (const oracle of [snapshot.base, snapshot.quote]) {
    const readings = [oracle, ...(oracle.crossCheck ? [oracle.crossCheck] : [])];
    const stale = readings.find(reading => reading.ageSeconds + EXECUTION_MARGIN_SECONDS > policy.maxPriceAge);
    if (stale) {
      return (
        `The ${stale.source} price of ${oracle.symbol} is ${stale.ageSeconds} s old; ` +
        `the vault refuses prices older than ${policy.maxPriceAge} s when the trade executes.`
      );
    }
    if (oracle.crossCheck && oracle.crossCheck.divergenceBps > policy.maxOracleDivergenceBps) {
      return (
        `Chainlink and Supra disagree on ${oracle.symbol} by ${oracle.crossCheck.divergenceBps} bps; ` +
        `the vault allows ${policy.maxOracleDivergenceBps} bps.`
      );
    }
  }
  return null;
}

function rejectionError(error: VaultError): Pick<Rejection, "error" | "detail"> {
  return { error: error.name.slice(0, MAX_ERROR_LENGTH), detail: error.detail.slice(0, MAX_DETAIL_LENGTH) };
}

/** What the strategy asked for, appended to a hold the agent imposed so the log keeps both. */
function describeWish(decision: Extract<StrategyDecision, { kind: "trade" }>): string {
  return `The strategy wanted to ${decision.side} ${formatUsd(decision.usd)}: ${decision.rationale}`;
}

function observation(oracle: OracleSnapshot): PriceObservation {
  return {
    feed: oracle.feed,
    source: oracle.source,
    price: formatUnits(BigInt(oracle.priceE18), 18),
    updatedAt: oracle.updatedAt,
    ...(oracle.crossCheck
      ? {
          crossCheck: formatUnits(BigInt(oracle.crossCheck.priceE18), 18),
          divergenceBps: oracle.crossCheck.divergenceBps,
        }
      : {}),
  };
}

function formatAmount(raw: bigint, holding: Holding): string {
  return `${formatUnits(raw, holding.token.decimals)} ${holding.token.symbol}`;
}

function formatBalance(holding: Holding): string {
  return formatAmount(BigInt(holding.token.balance), holding);
}

export function describeMarket(snapshot: MarketSnapshot): string {
  return [snapshot.base, snapshot.quote]
    .map(oracle => {
      const primary = `${oracle.symbol} ${formatUsdPrice(oracle.priceUsd)} (${oracle.source}, ${oracle.ageSeconds} s old)`;
      return oracle.crossCheck ? `${primary}, Supra ${oracle.crossCheck.divergenceBps} bps apart` : primary;
    })
    .join("; ");
}

function describeVault(portfolio: Portfolio, state: VaultState, cfg: AgentConfig): string {
  const holdings = [portfolio.base, portfolio.quote].map(h => `${formatBalance(h)} (${formatUsd(h.usd)})`).join(" + ");
  const percent = (weight: number) => `${(weight * 100).toFixed(1)}%`;
  const weight =
    portfolio.baseWeight === null
      ? "empty"
      : `${portfolio.base.token.symbol} at ${percent(portfolio.baseWeight)} (target ${percent(cfg.targetBaseWeight)})`;
  const trades = `${state.tradeCount} trade${state.tradeCount === 1 ? "" : "s"} so far`;
  return `${holdings}; ${weight}; ${trades}`;
}
