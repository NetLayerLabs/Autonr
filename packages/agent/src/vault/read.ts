import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  erc20Abi,
  zeroAddress,
} from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { chainTimestamp, readClient } from "../chain";
import { type ReadOnlyConfig } from "../config";
import { entityIdFromNum } from "../hedera";
import { type NetworkName } from "../networks";
import { vaultAccessAbi } from "./abi";

/** The vault's risk policy. USD fields are 18-decimal fixed point as decimal strings. */
export type VaultPolicy = {
  maxTradeUsd: string;
  dailyCapUsd: string;
  cooldown: number;
  maxPriceAge: number;
  maxSlippageBps: number;
  maxOracleDivergenceBps: number;
};

export type VaultToken = {
  address: Address;
  symbol: string;
  decimals: number;
  /** Raw balance held by the vault, in the token's smallest unit. */
  balance: string;
  chainlinkFeed: Address | null;
  /** Supra pair pricing or cross-checking the token, or null when Supra is disabled for it. */
  supraPairId: number | null;
};

export type VaultState = {
  address: Address;
  owner: Address;
  agent: Address;
  paused: boolean;
  policy: VaultPolicy;
  tokens: VaultToken[];
  /** Topic number as the vault stores it (0 disables trading); `topicId` is the same topic as 0.0.x. */
  hcsTopicNum: string;
  topicId: string | null;
  lastTradeAt: number;
  nextTradeAt: number;
  remainingDailyUsd: string;
  spentTodayUsd: string;
  tradeCount: number;
  lastReasoningSequence: number;
  /** SaucerSwap fee tier the owner approved for the configured base/quote pair; 0 when the pair may not trade. */
  poolFee: number;
};

const SECONDS_PER_DAY = 86_400;

/**
 * Reads the vault's owner, agent, policy, tokens (configuration, symbol, balance), decision topic, cooldown, daily
 * usage and the fee tier approved for the base/quote pair. Returns null when no vault is configured; throws when the address holds no AgentVault.
 */
export function readVaultState(cfg: ReadOnlyConfig & { vaultAddress: Address }): Promise<VaultState>;
export function readVaultState(cfg: ReadOnlyConfig): Promise<VaultState | null>;
export async function readVaultState(cfg: ReadOnlyConfig): Promise<VaultState | null> {
  const address = cfg.vaultAddress;
  if (!address) return null;
  const client = readClient(cfg);
  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    throw new Error(`no contract at vault address ${address} on ${cfg.network}; check AUTONR_VAULT_ADDRESS`);
  }

  const vault = { address, abi: agentVaultAbi } as const;
  const access = { address, abi: vaultAccessAbi } as const;
  try {
    const [
      owner,
      agent,
      paused,
      policy,
      allowed,
      topicNum,
      lastTradeAt,
      nextTradeAt,
      lastSequence,
      trades,
      remaining,
      poolFee,
      now,
    ] = await Promise.all([
      client.readContract({ ...access, functionName: "owner" }),
      client.readContract({ ...vault, functionName: "agent" }),
      client.readContract({ ...access, functionName: "paused" }),
      client.readContract({ ...vault, functionName: "policy" }),
      client.readContract({ ...vault, functionName: "allowedTokens" }),
      client.readContract({ ...vault, functionName: "hcsTopicNum" }),
      client.readContract({ ...vault, functionName: "lastTradeAt" }),
      client.readContract({ ...vault, functionName: "nextTradeAt" }),
      client.readContract({ ...vault, functionName: "lastReasoningSequence" }),
      client.readContract({ ...vault, functionName: "tradeCount" }),
      client.readContract({ ...vault, functionName: "remainingDailyUsd" }),
      client.readContract({
        ...vault,
        functionName: "poolFee",
        args: [cfg.baseToken.address, cfg.quoteToken.address],
      }),
      chainTimestamp(client),
    ]);
    // The vault buckets spending by UTC day of block time, so "today" comes from the chain, not the local clock.
    const today = BigInt(Math.floor(now / SECONDS_PER_DAY));
    const [spentToday, tokens] = await Promise.all([
      client.readContract({ ...vault, functionName: "spentUsdOn", args: [today] }),
      Promise.all(
        allowed.map(async (token): Promise<VaultToken> => {
          const [config, symbol, balance] = await Promise.all([
            client.readContract({ ...vault, functionName: "tokenConfig", args: [token] }),
            client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
            client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
          ]);
          return {
            address: token,
            symbol,
            decimals: config.decimals,
            balance: balance.toString(),
            chainlinkFeed: config.chainlinkFeed === zeroAddress ? null : config.chainlinkFeed,
            supraPairId: config.supraEnabled ? config.supraPairId : null,
          };
        }),
      ),
    ]);

    return {
      address,
      owner,
      agent,
      paused,
      policy: {
        maxTradeUsd: policy.maxTradeUsd.toString(),
        dailyCapUsd: policy.dailyCapUsd.toString(),
        cooldown: policy.cooldown,
        maxPriceAge: policy.maxPriceAge,
        maxSlippageBps: policy.maxSlippageBps,
        maxOracleDivergenceBps: policy.maxOracleDivergenceBps,
      },
      tokens,
      hcsTopicNum: topicNum.toString(),
      topicId: topicNum === 0n ? null : entityIdFromNum(topicNum),
      lastTradeAt: Number(lastTradeAt),
      nextTradeAt: Number(nextTradeAt),
      remainingDailyUsd: remaining.toString(),
      spentTodayUsd: spentToday.toString(),
      tradeCount: Number(trades),
      lastReasoningSequence: Number(lastSequence),
      poolFee,
    };
  } catch (error) {
    throw vaultReadError(error, address, cfg.network);
  }
}

/**
 * The error to report for a failed read of a vault view. A revert or an empty answer means the address holds no
 * AgentVault, which becomes an error naming the variable to check; transport failures are returned as they are.
 */
export function vaultReadError(error: unknown, vault: Address, network: NetworkName): unknown {
  const contractLevel =
    error instanceof BaseError &&
    error.walk(
      cause => cause instanceof ContractFunctionZeroDataError || cause instanceof ContractFunctionRevertedError,
    );
  if (!contractLevel) return error;
  return new Error(
    `vault ${vault} on ${network} does not answer like an AgentVault (check AUTONR_VAULT_ADDRESS): ${error.shortMessage}`,
    { cause: error },
  );
}
