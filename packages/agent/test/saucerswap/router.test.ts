import { decodeFunctionData, size, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { NETWORKS } from "../../src/networks";
import { swapRouterAbi } from "../../src/saucerswap/abi";
import { encodePath, hbarExactInputCalls } from "../../src/saucerswap/router";

const { baseToken: whbar, quoteToken: usdc } = NETWORKS.testnet;

describe("encodePath", () => {
  it("packs tokenIn | fee | tokenOut into 43 bytes", () => {
    // The exact path the testnet QuoterV2 accepted for WHBAR -> USDC at the 0.30% tier.
    const path = encodePath(whbar.address, 3000, usdc.address);
    expect(path).toBe("0x0000000000000000000000000000000000003ad2000bb80000000000000000000000000000000000001549");
    expect(size(path)).toBe(43);
  });

  it("encodes the fee as three big-endian bytes", () => {
    expect(encodePath(usdc.address, 500, whbar.address).slice(42, 48)).toBe("0001f4");
    expect(encodePath(usdc.address, 10_000, whbar.address).slice(42, 48)).toBe("002710");
  });

  it("rejects a fee that does not fit in uint24", () => {
    expect(() => encodePath(whbar.address, 2 ** 24, usdc.address)).toThrow();
  });
});

describe("hbarExactInputCalls", () => {
  const params = {
    path: encodePath(whbar.address, 3000, usdc.address),
    recipient: "0x0000000000000000000000000000000000001234",
    deadline: 1_790_000_000n,
    amountIn: 150_000_000n,
    amountOutMinimum: 2_900_000n,
  } as const;

  it("swaps with exactInput, then refunds unused HBAR", () => {
    const [swap, refund] = hbarExactInputCalls(params);
    expect(swap.slice(0, 10)).toBe("0xc04b8d59");
    expect(refund).toBe(toFunctionSelector("refundETH()"));
  });

  it("carries the swap parameters unchanged", () => {
    const [swap] = hbarExactInputCalls(params);
    const decoded = decodeFunctionData({ abi: swapRouterAbi, data: swap });
    expect(decoded.functionName).toBe("exactInput");
    expect(decoded.args?.[0]).toEqual(params);
  });
});
