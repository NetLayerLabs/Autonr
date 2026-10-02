import { type Address } from "viem";
import { hedera, hederaTestnet } from "viem/chains";

/**
 * Per-network constants. Every address here was checked on-chain on 2026-10-01 (contract code present, feeds live).
 * packages/foundry/script/HelperConfig.s.sol carries the same values for the deploy script; keep them in sync.
 *
 * EVM addresses of Hedera entities are "long-zero" addresses (0x000…<entity number in hex>), which is how SaucerSwap's
 * contracts and HTS tokens are reached from Solidity and JSON-RPC.
 */

export type NetworkName = "testnet" | "mainnet";

export type TokenRef = {
  symbol: string;
  /** Hedera token id, e.g. 0.0.15058. */
  id: string;
  address: Address;
  decimals: number;
  /** Chainlink USD feed pricing the token, or null when Supra alone prices it. */
  chainlinkFeed: Address | null;
  /** Human label of the Chainlink feed, e.g. "HBAR / USD". */
  chainlinkLabel: string | null;
  /** Supra pair index: HBAR_USDT = 75, USDC_USD = 89. */
  supraPairId: number;
  supraLabel: string;
};

export type ReferenceDeployment = {
  vault: Address;
  topicId: string;
  agentAccountId: string;
};

export type NetworkInfo = {
  name: NetworkName;
  chainId: number;
  rpcUrl: string;
  mirrorUrl: string;
  supra: Address;
  saucerswap: {
    router: Address;
    quoterV2: Address;
    factory: Address;
    /** Contract that wraps HBAR into the WHBAR token (deposit() payable). */
    whbar: Address;
    whbarHelper: Address;
  };
  /** The asset the agent manages, priced by Chainlink and cross-checked by Supra. */
  baseToken: TokenRef;
  /** The USD stablecoin, priced by Supra USDC_USD. */
  quoteToken: TokenRef;
  /** SaucerSwap V2 fee tier of the base/quote pool used by default (hundredths of a basis point). */
  defaultPoolFee: number;
  /**
   * The Autonr deployment the dashboard shows when no vault of your own is configured, so a fresh scaffold has live
   * data to explore. Your own `AUTONR_VAULT_ADDRESS` / `AUTONR_TOPIC_ID` always take precedence.
   */
  reference: ReferenceDeployment | null;
};

export const NETWORKS: Record<NetworkName, NetworkInfo> = {
  testnet: {
    name: "testnet",
    chainId: hederaTestnet.id,
    rpcUrl: "https://testnet.hashio.io/api",
    mirrorUrl: "https://testnet.mirrornode.hedera.com",
    supra: "0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917",
    saucerswap: {
      router: "0x0000000000000000000000000000000000159398", // 0.0.1414040 SaucerSwapV2SwapRouter
      quoterV2: "0x00000000000000000000000000000000001535b2", // 0.0.1390002 SaucerSwapV2QuoterV2
      factory: "0x00000000000000000000000000000000001243ee", // 0.0.1197038 SaucerSwapV2Factory
      whbar: "0x0000000000000000000000000000000000003ad1", // 0.0.15057 WHBAR contract
      whbarHelper: "0x000000000000000000000000000000000050a8a7", // 0.0.5286055 WhbarHelper
    },
    baseToken: {
      symbol: "WHBAR",
      id: "0.0.15058",
      address: "0x0000000000000000000000000000000000003ad2",
      decimals: 8,
      chainlinkFeed: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a",
      chainlinkLabel: "HBAR / USD",
      supraPairId: 75,
      supraLabel: "HBAR_USDT",
    },
    quoteToken: {
      symbol: "USDC",
      id: "0.0.5449",
      address: "0x0000000000000000000000000000000000001549",
      decimals: 6,
      chainlinkFeed: null,
      chainlinkLabel: null,
      supraPairId: 89,
      supraLabel: "USDC_USD",
    },
    defaultPoolFee: 3000,
    reference: {
      vault: "0x037b24d59836e1C0cb9Fe571f004409D81eba472",
      topicId: "0.0.10821549",
      agentAccountId: "0.0.10821548",
    },
  },
  mainnet: {
    name: "mainnet",
    chainId: hedera.id,
    rpcUrl: "https://mainnet.hashio.io/api",
    mirrorUrl: "https://mainnet.mirrornode.hedera.com",
    supra: "0xD02cc7a670047b6b012556A88e275c685d25e0c9",
    saucerswap: {
      router: "0x00000000000000000000000000000000003c437a", // 0.0.3949434 SaucerSwapV2SwapRouter
      quoterV2: "0x00000000000000000000000000000000003c4370", // 0.0.3949424 SaucerSwapV2QuoterV2
      factory: "0x00000000000000000000000000000000003c3951", // 0.0.3946833 SaucerSwapV2Factory
      whbar: "0x0000000000000000000000000000000000163b59", // 0.0.1456985 WHBAR contract
      whbarHelper: "0x000000000000000000000000000000000058a2ba", // 0.0.5808826 WhbarHelper
    },
    baseToken: {
      symbol: "WHBAR",
      id: "0.0.1456986",
      address: "0x0000000000000000000000000000000000163b5a",
      decimals: 8,
      chainlinkFeed: "0xAF685FB45C12b92b5054ccb9313e135525F9b5d5",
      chainlinkLabel: "HBAR / USD",
      supraPairId: 75,
      supraLabel: "HBAR_USDT",
    },
    quoteToken: {
      symbol: "USDC",
      id: "0.0.456858",
      address: "0x000000000000000000000000000000000006f89a",
      decimals: 6,
      chainlinkFeed: null,
      chainlinkLabel: null,
      supraPairId: 89,
      supraLabel: "USDC_USD",
    },
    defaultPoolFee: 1500,
    reference: null,
  },
};

export function getNetwork(name: NetworkName): NetworkInfo {
  return NETWORKS[name];
}

export function isNetworkName(value: string): value is NetworkName {
  return value === "testnet" || value === "mainnet";
}
