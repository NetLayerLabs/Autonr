import { type Address, encodeFunctionData, encodePacked, type Hex } from "viem";
import { swapRouterAbi } from "./abi";

/** Single-hop path as the router and the vault build it: tokenIn (20 bytes) | fee (3 bytes) | tokenOut (20 bytes). */
export function encodePath(tokenIn: Address, fee: number, tokenOut: Address): Hex {
  return encodePacked(["address", "uint24", "address"], [tokenIn, fee, tokenOut]);
}

type HbarExactInput = {
  /** Must start with the WHBAR token: the router wraps the HBAR it receives before swapping. */
  path: Hex;
  recipient: Address;
  /** Unix seconds. */
  deadline: bigint;
  /** Tinybars. Send the same amount as the transaction value (in weibars over JSON-RPC). */
  amountIn: bigint;
  amountOutMinimum: bigint;
};

/**
 * Calldata items for `SwapRouter.multicall` that sell exactly `amountIn` of HBAR. This is the sequence SaucerSwap
 * documents: `refundETH` returns any HBAR the swap did not consume instead of leaving it in the router.
 */
export function hbarExactInputCalls(params: HbarExactInput): [swap: Hex, refund: Hex] {
  return [
    encodeFunctionData({ abi: swapRouterAbi, functionName: "exactInput", args: [params] }),
    encodeFunctionData({ abi: swapRouterAbi, functionName: "refundETH" }),
  ];
}
