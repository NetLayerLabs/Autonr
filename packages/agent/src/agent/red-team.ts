import { type Address, getAddress, isAddressEqual, keccak256, slice, toBytes, zeroHash } from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { type HederaPublicClient, readClient } from "../chain";
import { type ReadOnlyConfig } from "../config";
import { longZeroAddress } from "../hedera";
import { amountForUsd } from "../oracles/math";
import { vaultToken } from "../strategy/portfolio";
import { readVaultState } from "../vault/read";
import { type SimulationResult, simulateSwap, type SwapCall } from "../vault/simulate";
import { describeError } from "./log";

export type RedTeamScenarioId =
  | "oversize"
  | "unlisted-token"
  | "unapproved-fee"
  | "no-reasoning"
  | "replayed-reasoning"
  | "not-agent";

export type RedTeamScenario = { id: RedTeamScenarioId; title: string; rule: string; expectedError: string };

/** Each scenario breaks exactly one rule of the vault; everything else about the call is a valid trade. */
export const RED_TEAM_SCENARIOS: readonly RedTeamScenario[] = [
  {
    id: "oversize",
    title: "Oversized trade",
    rule: "The vault prices every trade with its own oracles and refuses anything above the per-trade cap.",
    expectedError: "TradeTooLarge",
  },
  {
    id: "unlisted-token",
    title: "Unlisted token",
    rule: "Both legs must be tokens the owner configured; the agent cannot route funds anywhere else.",
    expectedError: "TokenNotAllowed",
  },
  {
    id: "unapproved-fee",
    title: "Unapproved fee tier",
    rule: "Swaps go through the one SaucerSwap pool fee tier the owner approved for the pair, never one the agent picks.",
    expectedError: "PoolFeeNotAllowed",
  },
  {
    id: "no-reasoning",
    title: "Trade without published reasoning",
    rule: "Every trade must cite the keccak256 of an HCS message holding the agent's reasoning.",
    expectedError: "ReasoningRequired",
  },
  {
    id: "replayed-reasoning",
    title: "Replayed reasoning",
    rule: "Each trade must cite a newer HCS sequence number than the previous trade, so reasoning cannot be reused.",
    expectedError: "ReasoningOutOfOrder",
  },
  {
    id: "not-agent",
    title: "Someone other than the agent",
    rule: "Only the agent account may call executeSwap; not even the owner can trade.",
    expectedError: "NotAgent",
  },
];

export type RedTeamResult = {
  id: RedTeamScenarioId;
  rejected: boolean;
  error: string;
  detail: string;
  expectedError: string;
  matchedExpectation: boolean;
  request: Record<string, string>;
};

/** What a scenario needs to know about the vault to build its call. */
export type RedTeamContext = {
  vault: Address;
  agent: Address;
  owner: Address;
  baseToken: Address;
  quoteToken: Address;
  baseDecimals: number;
  basePriceE18: bigint;
  /** The fee tier the vault approved for the pair, which every valid trade must use. */
  poolFee: number;
  maxTradeUsdE18: bigint;
  lastReasoningSequence: number;
};

/**
 * Hedera's relay refuses to simulate a call from an address that has no account ("Sender account not found"), so the
 * impostor must be a real account: the owner, or the network treasury 0.0.2 when the owner is also the agent.
 */
const TREASURY = longZeroAddress("0.0.2");

/** A well-formed address no vault will ever allow, derived rather than random so every run sends the same call. */
const UNLISTED_TOKEN = getAddress(slice(keccak256(toBytes("autonr:red-team:unlisted-token")), 12));

const ONE_USD_E18 = 10n ** 18n;

/** The call each scenario sends: a $1 sale of the base token by the agent, with one rule broken. */
export function redTeamCall(id: RedTeamScenarioId, ctx: RedTeamContext): { from: Address; call: SwapCall } {
  const sellUsd = (usdE18: bigint) => amountForUsd(usdE18, ctx.basePriceE18, ctx.baseDecimals);
  const valid = {
    from: ctx.agent,
    call: {
      vault: ctx.vault,
      request: {
        tokenIn: ctx.baseToken,
        tokenOut: ctx.quoteToken,
        poolFee: ctx.poolFee,
        amountIn: sellUsd(ONE_USD_E18),
      },
      reasoning: { hash: keccak256(toBytes(`autonr:red-team:${id}`)), sequence: BigInt(ctx.lastReasoningSequence + 1) },
    },
  };
  const { request, reasoning } = valid.call;
  switch (id) {
    case "oversize":
      return {
        ...valid,
        call: { ...valid.call, request: { ...request, amountIn: sellUsd(ctx.maxTradeUsdE18 * 10n) } },
      };
    case "unlisted-token":
      return { ...valid, call: { ...valid.call, request: { ...request, tokenOut: UNLISTED_TOKEN } } };
    case "unapproved-fee":
      return { ...valid, call: { ...valid.call, request: { ...request, poolFee: otherFeeTier(ctx.poolFee) } } };
    case "no-reasoning":
      return { ...valid, call: { ...valid.call, reasoning: { ...reasoning, hash: zeroHash } } };
    case "replayed-reasoning":
      return {
        ...valid,
        call: { ...valid.call, reasoning: { ...reasoning, sequence: BigInt(ctx.lastReasoningSequence) } },
      };
    case "not-agent":
      return { ...valid, from: isAddressEqual(ctx.owner, ctx.agent) ? TREASURY : ctx.owner };
  }
}

/** A real SaucerSwap V2 fee tier other than the approved one. */
function otherFeeTier(approved: number): number {
  return approved === 10_000 ? 3000 : 10_000;
}

/**
 * Sends one scenario's call to the vault as an eth_call: nothing is signed and nothing changes on-chain, but the answer
 * is the vault's real verdict on the current state. A scenario can be refused for an earlier reason than the one it
 * targets (the vault is paused, a cooldown runs); the result then reports the actual error and no match.
 */
export async function runRedTeam(cfg: ReadOnlyConfig, id: RedTeamScenarioId): Promise<RedTeamResult> {
  const scenario = RED_TEAM_SCENARIOS.find(candidate => candidate.id === id);
  if (!scenario) throw new Error(`unknown red-team scenario "${id}"`);
  const state = await readVaultState(cfg);
  if (!state) throw new Error("no vault configured: set AUTONR_VAULT_ADDRESS");

  const client = readClient(cfg);
  const base = vaultToken(state, cfg.baseToken);
  const [reading, blockNumber] = await Promise.all([
    client.readContract({
      address: state.address,
      abi: agentVaultAbi,
      functionName: "oracleReading",
      args: [base.address],
    }),
    client.getBlockNumber(),
  ]);
  const { from, call } = redTeamCall(id, {
    vault: state.address,
    agent: state.agent,
    owner: state.owner,
    baseToken: base.address,
    quoteToken: vaultToken(state, cfg.quoteToken).address,
    baseDecimals: base.decimals,
    basePriceE18: reading.priceE18,
    poolFee: state.poolFee,
    maxTradeUsdE18: BigInt(state.policy.maxTradeUsd),
    lastReasoningSequence: state.lastReasoningSequence,
  });

  const result = await simulateWithRetry(client, call, from, blockNumber);
  const request = describeRequest(from, call, blockNumber);
  if (result.ok) {
    return {
      id,
      rejected: false,
      error: "",
      detail: `the vault accepted the call and would have returned ${result.amountOut}`,
      expectedError: scenario.expectedError,
      matchedExpectation: false,
      request,
    };
  }
  return {
    id,
    rejected: true,
    error: result.error.name,
    detail: result.error.detail,
    expectedError: scenario.expectedError,
    matchedExpectation: result.error.name === scenario.expectedError,
    request,
  };
}

function describeRequest(from: Address, { request, reasoning }: SwapCall, blockNumber: bigint): Record<string, string> {
  return {
    from,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    poolFee: String(request.poolFee),
    amountIn: request.amountIn.toString(),
    reasoningHash: reasoning.hash,
    sequence: reasoning.sequence.toString(),
    block: blockNumber.toString(),
  };
}

/** Narrows user input (a CLI flag, a request body) to a scenario id. */
export function isRedTeamScenarioId(value: unknown): value is RedTeamScenarioId {
  return RED_TEAM_SCENARIOS.some(scenario => scenario.id === value);
}

/** One pause before a second attempt: the public relay occasionally drops an eth_call under load. Exported for tests. */
const RETRY_DELAY_MS = 1_500;

/**
 * A revert is the scenario's answer and comes back as a result; only a transport failure throws. The simulation is
 * read-only, so it is retried once before the scenario is given up as unreachable.
 */
export async function simulateWithRetry(
  client: HederaPublicClient,
  call: SwapCall,
  from: Address,
  blockNumber: bigint,
): Promise<SimulationResult> {
  try {
    return await simulateSwap(client, call, from, blockNumber);
  } catch (first: unknown) {
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    return simulateSwap(client, call, from, blockNumber).catch((error: unknown) => {
      throw new Error(
        `the relay could not simulate a call from ${from} (twice; first: ${describeError(first)}): ${describeError(error)}`,
        { cause: error },
      );
    });
  }
}
