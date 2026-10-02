import { type Address, isAddressEqual, zeroAddress } from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { chainTimestamp, type HederaPublicClient, readClient } from "../chain";
import { type ReadOnlyConfig } from "../config";
import { getNetwork, type TokenRef } from "../networks";
import { vaultReadError } from "../vault/read";
import { type Observation, readChainlink } from "./chainlink";
import { e18ToNumber, readingE18 } from "./math";
import { readSupra } from "./supra";

export type OracleSnapshot = {
  token: Address;
  symbol: string;
  /** Label of the primary feed, e.g. "HBAR / USD" (Chainlink) or "USDC_USD" (Supra). */
  feed: string;
  source: "chainlink" | "supra";
  priceUsd: number;
  priceE18: string;
  updatedAt: number;
  ageSeconds: number;
  /** Supra's price for the same asset when it cross-checks Chainlink. */
  crossCheck: {
    source: "supra";
    priceUsd: number;
    priceE18: string;
    updatedAt: number;
    ageSeconds: number;
    divergenceBps: number;
  } | null;
};

export type MarketSnapshot = {
  /** Consensus time the snapshot was read at; ages are measured against it, as the vault measures them. */
  fetchedAt: number;
  base: OracleSnapshot;
  quote: OracleSnapshot;
};

/** Which oracles price a token: the vault's own `tokenConfig` when a vault is configured, else the network defaults. */
export type TokenPricing = {
  chainlinkFeed: Address | null;
  /** Null when Supra is disabled for the token. */
  supraPairId: number | null;
};

/**
 * Reads both tokens' oracles straight from the Chainlink and Supra contracts, with the vault's pricing rule: Chainlink
 * prices a token that has a feed and Supra, when enabled, cross-checks it; a token without a feed is priced by Supra
 * alone. With a vault configured, the feeds and pairs come from its on-chain token configuration, so the agent sees
 * the prices the vault will enforce. Without one the network defaults apply, so the dashboard can show prices before
 * anything is deployed.
 */
export async function fetchMarketSnapshot(cfg: ReadOnlyConfig): Promise<MarketSnapshot> {
  const client = readClient(cfg);
  const supra = getNetwork(cfg.network).supra;
  const [basePricing, quotePricing] = await Promise.all([
    tokenPricing(client, cfg, cfg.baseToken),
    tokenPricing(client, cfg, cfg.quoteToken),
  ]);
  const [fetchedAt, base, quote] = await Promise.all([
    chainTimestamp(client),
    observeToken(client, supra, basePricing),
    observeToken(client, supra, quotePricing),
  ]);
  return {
    fetchedAt,
    base: toSnapshot(cfg.baseToken, basePricing, base, fetchedAt),
    quote: toSnapshot(cfg.quoteToken, quotePricing, quote, fetchedAt),
  };
}

async function tokenPricing(client: HederaPublicClient, cfg: ReadOnlyConfig, token: TokenRef): Promise<TokenPricing> {
  const defaults = { chainlinkFeed: token.chainlinkFeed, supraPairId: token.supraPairId };
  const vault = cfg.vaultAddress;
  if (!vault) return defaults;
  const config = await client
    .readContract({ address: vault, abi: agentVaultAbi, functionName: "tokenConfig", args: [token.address] })
    .catch((error: unknown) => {
      throw vaultReadError(error, vault, cfg.network);
    });
  // A token the vault does not allow cannot trade at all; its default feeds still describe the market.
  return config.allowed ? pricingOf(config) : defaults;
}

/** The vault's pricing of a token, from `tokenConfig(token)`. */
export function pricingOf(config: {
  chainlinkFeed: Address;
  supraPairId: number;
  supraEnabled: boolean;
}): TokenPricing {
  return {
    chainlinkFeed: config.chainlinkFeed === zeroAddress ? null : config.chainlinkFeed,
    supraPairId: config.supraEnabled ? config.supraPairId : null,
  };
}

type TokenObservation = { chainlink: Observation | null; supra: Observation | null };

async function observeToken(
  client: HederaPublicClient,
  supra: Address,
  pricing: TokenPricing,
): Promise<TokenObservation> {
  const [chainlink, supraPrice] = await Promise.all([
    pricing.chainlinkFeed ? readChainlink(client, pricing.chainlinkFeed) : null,
    pricing.supraPairId === null ? null : readSupra(client, supra, pricing.supraPairId),
  ]);
  return { chainlink, supra: supraPrice };
}

/** Feed labels for the decision record (at most 16 characters); the network's own labels when the feed is the default. */
function feedLabel(token: TokenRef, pricing: TokenPricing, source: "chainlink" | "supra"): string {
  if (source === "chainlink") {
    const isDefault =
      token.chainlinkFeed !== null &&
      pricing.chainlinkFeed !== null &&
      isAddressEqual(pricing.chainlinkFeed, token.chainlinkFeed);
    return isDefault && token.chainlinkLabel ? token.chainlinkLabel : `${token.symbol} / USD`.slice(0, 16);
  }
  return pricing.supraPairId === token.supraPairId ? token.supraLabel : `Supra pair ${pricing.supraPairId}`;
}

function toSnapshot(token: TokenRef, pricing: TokenPricing, observed: TokenObservation, now: number): OracleSnapshot {
  const primary = observed.chainlink ?? observed.supra;
  // The vault refuses to configure a token without a price source, so this only fires on a broken configuration.
  if (!primary) throw new Error(`no oracle prices ${token.symbol}: it has neither a Chainlink feed nor a Supra pair`);
  const crossCheck = observed.chainlink ? observed.supra : null;
  const source = observed.chainlink ? "chainlink" : "supra";
  const reading = readingE18(primary, crossCheck);
  return {
    token: token.address,
    symbol: token.symbol,
    feed: feedLabel(token, pricing, source),
    source,
    ...priceFields(reading.priceE18, primary.updatedAt, now),
    crossCheck: crossCheck
      ? {
          source: "supra",
          ...priceFields(reading.crossCheckE18, crossCheck.updatedAt, now),
          divergenceBps: Number(reading.divergenceBps),
        }
      : null,
  };
}

type PriceFields = Pick<OracleSnapshot, "priceUsd" | "priceE18" | "updatedAt" | "ageSeconds">;

function priceFields(priceE18: bigint, updatedAt: number, now: number): PriceFields {
  // Oracle timestamps can run a second or two ahead of the latest block; an age is never negative.
  return {
    priceUsd: e18ToNumber(priceE18),
    priceE18: priceE18.toString(),
    updatedAt,
    ageSeconds: Math.max(0, now - updatedAt),
  };
}
