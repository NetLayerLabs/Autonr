import { agentVaultAbi } from "@sh/agent/abi";
import { TRACE_SELECTORS } from "@sh/agent/evaluate";
import { type NetworkName, getNetwork } from "@sh/agent/networks";
import { type Hex, getAbiItem, toFunctionSelector } from "viem";

export type CallRole = "vault" | "oracle" | "swap" | "token" | "other";

type KnownFunction = { label: string; role: CallRole };

const OTHER_SIGNATURES: [string, KnownFunction][] = [
  ["swap(address,bool,int256,uint160,bytes)", { label: "swap", role: "swap" }],
  ["uniswapV3SwapCallback(int256,int256,bytes)", { label: "uniswapV3SwapCallback", role: "swap" }],
  // On Hedera, pools move HTS tokens through the token service system contract at 0x167.
  ["transferToken(address,address,address,int64)", { label: "transferToken", role: "token" }],
  ["transfer(address,uint256)", { label: "transfer", role: "token" }],
  ["transferFrom(address,address,uint256)", { label: "transferFrom", role: "token" }],
  ["approve(address,uint256)", { label: "approve", role: "token" }],
  ["balanceOf(address)", { label: "balanceOf", role: "token" }],
  ["allowance(address,address)", { label: "allowance", role: "token" }],
  ["decimals()", { label: "decimals", role: "other" }],
];

// The oracle and swap selectors come from the verifier itself, so the X-ray highlights exactly what atomic-trace checks.
const FUNCTIONS = new Map<string, KnownFunction>([
  [
    toFunctionSelector(getAbiItem({ abi: agentVaultAbi, name: "executeSwap" })),
    { label: "executeSwap", role: "vault" },
  ],
  [TRACE_SELECTORS.chainlinkLatestRoundData, { label: "latestRoundData", role: "oracle" }],
  [TRACE_SELECTORS.supraGetSvalue, { label: "getSvalue", role: "oracle" }],
  [TRACE_SELECTORS.saucerswapExactInput, { label: "exactInput", role: "swap" }],
  ...OTHER_SIGNATURES.map(([signature, known]): [string, KnownFunction] => [toFunctionSelector(signature), known]),
]);

export function describeCall(selector: Hex): KnownFunction {
  return FUNCTIONS.get(selector.toLowerCase()) ?? { label: selector, role: "other" };
}

export function isSaucerSwapEntry(selector: Hex): boolean {
  return selector.toLowerCase() === TRACE_SELECTORS.saucerswapExactInput;
}

const HTS_SYSTEM_CONTRACT = "0x0000000000000000000000000000000000000167";

/** Names for the contracts a trade touches, keyed by lowercase EVM address. */
export function contractNames(network: NetworkName, vault: string): Map<string, string> {
  const { saucerswap, supra, baseToken, quoteToken } = getNetwork(network);
  const names: [string, string][] = [
    [vault, "AgentVault"],
    [saucerswap.router, "SaucerSwap V2 router"],
    [supra, "Supra oracle"],
    [HTS_SYSTEM_CONTRACT, "HTS system contract"],
  ];
  for (const token of [baseToken, quoteToken]) {
    names.push([token.address, token.symbol]);
    if (token.chainlinkFeed) names.push([token.chainlinkFeed, `Chainlink ${token.chainlinkLabel ?? "feed"}`]);
  }
  return new Map(names.map(([address, name]) => [address.toLowerCase(), name]));
}
