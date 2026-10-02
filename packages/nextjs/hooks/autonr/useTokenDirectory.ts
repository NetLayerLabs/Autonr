import { useCallback, useMemo } from "react";
import { useHealth, useVault } from "./useAutonrApi";

export type TokenInfo = { address: string; symbol: string; decimals: number };

/** Looks up symbol and decimals for the tokens the dashboard knows: the configured pair plus the vault's tokens. */
export function useTokenDirectory(): (address: string) => TokenInfo | null {
  const { data: health } = useHealth();
  const { data: vault } = useVault();

  const tokens = useMemo(() => {
    const byAddress = new Map<string, TokenInfo>();
    const known: TokenInfo[] = [
      ...(health ? [health.baseToken, health.quoteToken] : []),
      ...(vault?.configured ? vault.vault.tokens : []),
    ];
    for (const token of known) byAddress.set(token.address.toLowerCase(), token);
    return byAddress;
  }, [health, vault]);

  return useCallback((address: string) => tokens.get(address.toLowerCase()) ?? null, [tokens]);
}
