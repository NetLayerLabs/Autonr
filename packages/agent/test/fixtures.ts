import { type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { type AgentConfig } from "../src/config";
import { NETWORKS, type TokenRef } from "../src/networks";
import { type MarketSnapshot, type OracleSnapshot } from "../src/oracles/snapshot";
import { type VaultState } from "../src/vault/read";

export const { baseToken: whbar, quoteToken: usdc } = NETWORKS.testnet;

/** A throwaway key: it controls nothing on any network. */
export const AGENT_KEY: Hex = `0x${"11".repeat(32)}`;
export const AGENT_ADDRESS = privateKeyToAddress(AGENT_KEY);
export const OWNER_ADDRESS: Address = "0x00000000000000000000000000000000000007e1";
export const VAULT_ADDRESS: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const TOPIC_ID = "0.0.5005";
export const NOW = 1_790_000_000;

const E18 = 10n ** 18n;

/** Endpoints are unreachable on purpose: tests inject every network interaction. */
export function agentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    network: "testnet",
    rpcUrl: "http://127.0.0.1:1",
    mirrorUrl: "http://127.0.0.1:1",
    vaultAddress: VAULT_ADDRESS,
    topicId: TOPIC_ID,
    agentAccountId: "0.0.5004",
    agentAddress: AGENT_ADDRESS,
    agentPrivateKey: AGENT_KEY,
    baseToken: whbar,
    quoteToken: usdc,
    poolFee: 3000,
    tickApiEnabled: false,
    strategy: "rebalance",
    tradeUsd: 5,
    targetBaseWeight: 0.5,
    logHolds: true,
    llm: null,
    ...overrides,
  };
}

export function oracle(
  token: TokenRef,
  priceE18: bigint,
  options: { ageSeconds?: number; crossCheckE18?: bigint; divergenceBps?: number } = {},
): OracleSnapshot {
  const ageSeconds = options.ageSeconds ?? 30;
  return {
    token: token.address,
    symbol: token.symbol,
    feed: token.chainlinkLabel ?? token.supraLabel,
    source: token.chainlinkFeed ? "chainlink" : "supra",
    priceUsd: Number(priceE18) / 1e18,
    priceE18: priceE18.toString(),
    updatedAt: NOW - ageSeconds,
    ageSeconds,
    crossCheck: options.crossCheckE18
      ? {
          source: "supra",
          priceUsd: Number(options.crossCheckE18) / 1e18,
          priceE18: options.crossCheckE18.toString(),
          updatedAt: NOW - ageSeconds,
          ageSeconds,
          divergenceBps: options.divergenceBps ?? 0,
        }
      : null,
  };
}

/** Chainlink HBAR / USD at $0.10245 with Supra 81 bps away, and Supra USDC_USD at $0.99997 (the shared vectors). */
export function marketSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    fetchedAt: NOW,
    base: oracle(whbar, 102_450_000_000_000_000n, { crossCheckE18: 103_280_000_000_000_000n, divergenceBps: 81 }),
    quote: oracle(usdc, 999_970_000_000_000_000n),
    ...overrides,
  };
}

/**
 * A wired vault: this agent, this topic, $10 per trade, $40 left of a $50 day. By default it holds 500 WHBAR
 * ($51.23) and 10 USDC ($10.00), so the rebalance strategy wants to sell WHBAR.
 */
export function vaultState(
  overrides: Partial<VaultState> = {},
  balances: { base?: bigint; quote?: bigint } = {},
): VaultState {
  return {
    address: VAULT_ADDRESS,
    owner: OWNER_ADDRESS,
    agent: AGENT_ADDRESS,
    paused: false,
    policy: {
      maxTradeUsd: (10n * E18).toString(),
      dailyCapUsd: (50n * E18).toString(),
      cooldown: 60,
      maxPriceAge: 3_600,
      maxSlippageBps: 300,
      maxOracleDivergenceBps: 100,
    },
    tokens: [
      {
        address: whbar.address,
        symbol: whbar.symbol,
        decimals: whbar.decimals,
        balance: (balances.base ?? 500n * 10n ** 8n).toString(),
        chainlinkFeed: whbar.chainlinkFeed,
        supraPairId: whbar.supraPairId,
      },
      {
        address: usdc.address,
        symbol: usdc.symbol,
        decimals: usdc.decimals,
        balance: (balances.quote ?? 10n * 10n ** 6n).toString(),
        chainlinkFeed: null,
        supraPairId: usdc.supraPairId,
      },
    ],
    hcsTopicNum: "5005",
    topicId: TOPIC_ID,
    lastTradeAt: NOW - 600,
    nextTradeAt: NOW - 540,
    remainingDailyUsd: (40n * E18).toString(),
    spentTodayUsd: (10n * E18).toString(),
    tradeCount: 3,
    lastReasoningSequence: 7,
    poolFee: 3000,
    ...overrides,
  };
}
