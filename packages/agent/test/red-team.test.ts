import { zeroHash } from "viem";
import { describe, expect, it } from "vitest";
import { agentVaultAbi } from "../src/abi/agentVault";
import {
  isRedTeamScenarioId,
  RED_TEAM_SCENARIOS,
  redTeamCall,
  type RedTeamContext,
  type RedTeamScenarioId,
} from "../src/agent/red-team";
import { longZeroAddress } from "../src/hedera";
import { AGENT_ADDRESS, OWNER_ADDRESS, usdc, VAULT_ADDRESS, whbar } from "./fixtures";

const E18 = 10n ** 18n;

const ctx: RedTeamContext = {
  vault: VAULT_ADDRESS,
  agent: AGENT_ADDRESS,
  owner: OWNER_ADDRESS,
  baseToken: whbar.address,
  quoteToken: usdc.address,
  baseDecimals: 8,
  basePriceE18: E18 / 10n, // $0.10
  poolFee: 3000,
  maxTradeUsdE18: 10n * E18,
  lastReasoningSequence: 7,
};

/** $1 of WHBAR at $0.10. */
const ONE_DOLLAR_OF_WHBAR = 10n * 10n ** 8n;

/** Everything about a call a rule can look at, flattened so scenarios can be compared field by field. */
function view(id: RedTeamScenarioId) {
  const { from, call } = redTeamCall(id, ctx);
  return {
    from,
    vault: call.vault,
    tokenIn: call.request.tokenIn,
    tokenOut: call.request.tokenOut,
    poolFee: call.request.poolFee,
    amountIn: call.request.amountIn,
    sequence: call.reasoning.sequence,
    reasoningPublished: call.reasoning.hash !== zeroHash,
  };
}

/** A valid trade: the agent sells $1 of WHBAR for USDC, citing a newer HCS sequence number. */
const VALID: ReturnType<typeof view> = {
  from: AGENT_ADDRESS,
  vault: VAULT_ADDRESS,
  tokenIn: whbar.address,
  tokenOut: usdc.address,
  poolFee: 3000,
  amountIn: ONE_DOLLAR_OF_WHBAR,
  sequence: 8n,
  reasoningPublished: true,
};

const BROKEN: Record<RedTeamScenarioId, Partial<ReturnType<typeof view>>> = {
  oversize: { amountIn: 100n * ONE_DOLLAR_OF_WHBAR },
  "unlisted-token": { tokenOut: redTeamCall("unlisted-token", ctx).call.request.tokenOut },
  "unapproved-fee": { poolFee: 10_000 },
  "no-reasoning": { reasoningPublished: false },
  "replayed-reasoning": { sequence: 7n },
  "not-agent": { from: OWNER_ADDRESS },
};

describe("red-team scenarios", () => {
  it("each expect a real IAgentVault error", () => {
    const errors = new Set<string>(agentVaultAbi.filter(item => item.type === "error").map(item => item.name));
    expect(new Set(RED_TEAM_SCENARIOS.map(scenario => scenario.id)).size).toBe(RED_TEAM_SCENARIOS.length);
    for (const scenario of RED_TEAM_SCENARIOS) expect(errors.has(scenario.expectedError)).toBe(true);
  });

  it("validate user input", () => {
    expect(isRedTeamScenarioId("oversize")).toBe(true);
    expect(isRedTeamScenarioId("drain-the-vault")).toBe(false);
  });

  it.each(RED_TEAM_SCENARIOS.map(scenario => scenario.id))("%s breaks exactly one rule of a valid trade", id => {
    expect(view(id)).toEqual({ ...VALID, ...BROKEN[id] });
    expect(Object.keys(BROKEN[id])).toHaveLength(1);
  });

  it("sends an unlisted token that is neither leg of the pair, the same one on every run", () => {
    const { tokenOut } = view("unlisted-token");
    expect([whbar.address, usdc.address]).not.toContain(tokenOut);
    expect(view("unlisted-token").tokenOut).toBe(tokenOut);
  });

  it("impersonates the treasury when the owner is also the agent, since the relay needs a real sender", () => {
    expect(redTeamCall("not-agent", { ...ctx, owner: AGENT_ADDRESS }).from).toBe(longZeroAddress("0.0.2"));
  });
});
