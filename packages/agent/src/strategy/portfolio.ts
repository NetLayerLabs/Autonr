import { formatUnits, isAddressEqual } from "viem";
import { type ReadOnlyConfig } from "../config";
import { type TokenRef } from "../networks";
import { type MarketSnapshot, type OracleSnapshot } from "../oracles/snapshot";
import { type VaultState, type VaultToken } from "../vault/read";

export type Holding = {
  token: VaultToken;
  oracle: OracleSnapshot;
  /** Whole tokens. */
  amount: number;
  usd: number;
};

export type Portfolio = {
  base: Holding;
  quote: Holding;
  totalUsd: number;
  /** Share of the USD value held in the base token; null for an empty vault. */
  baseWeight: number | null;
};

/** Values the vault's base and quote balances at the oracle prices. */
export function portfolioOf(cfg: ReadOnlyConfig, snapshot: MarketSnapshot, state: VaultState): Portfolio {
  const base = holding(vaultToken(state, cfg.baseToken), snapshot.base);
  const quote = holding(vaultToken(state, cfg.quoteToken), snapshot.quote);
  const totalUsd = base.usd + quote.usd;
  return { base, quote, totalUsd, baseWeight: totalUsd > 0 ? base.usd / totalUsd : null };
}

/** The vault's configuration of `token`; trading a token the vault does not allow can only revert. */
export function vaultToken(state: VaultState, token: TokenRef): VaultToken {
  const found = state.tokens.find(candidate => isAddressEqual(candidate.address, token.address));
  if (!found) {
    throw new Error(
      `vault ${state.address} does not allow ${token.symbol} (${token.id}); its owner must call configureToken first`,
    );
  }
  return found;
}

function holding(token: VaultToken, oracle: OracleSnapshot): Holding {
  const amount = Number(formatUnits(BigInt(token.balance), token.decimals));
  return { token, oracle, amount, usd: amount * oracle.priceUsd };
}
