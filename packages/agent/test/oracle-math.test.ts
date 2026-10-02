import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { amountForUsd, divergenceBps, quoteSwap, readingE18, toE18, usdToE18 } from "../src/oracles/math";
import { supraTimeToSeconds } from "../src/oracles/supra";

const rawPrice = z.object({ value: z.string(), decimals: z.number().int() });
const reading = z.object({
  primary: rawPrice,
  crossCheck: rawPrice.nullable(),
  expected: z.object({ priceE18: z.string(), crossCheckE18: z.string(), divergenceBps: z.number().int() }),
});
const vectors = z
  .array(
    z.object({
      name: z.string(),
      amountIn: z.string(),
      decimalsIn: z.number().int(),
      decimalsOut: z.number().int(),
      maxSlippageBps: z.number().int(),
      oracleIn: reading,
      oracleOut: reading,
      expected: z.object({ usdValue: z.string(), expectedOut: z.string(), minAmountOut: z.string() }),
    }),
  )
  .parse(JSON.parse(readFileSync(new URL("../../foundry/test/vectors/oracle-math.json", import.meta.url), "utf8")));

const toRaw = (price: z.infer<typeof rawPrice>) => ({ value: BigInt(price.value), decimals: price.decimals });

describe("parity with the Solidity vectors", () => {
  it.each(vectors.map(vector => [vector.name, vector] as const))("%s", (_name, vector) => {
    const legs = [vector.oracleIn, vector.oracleOut].map(leg => {
      const result = readingE18(toRaw(leg.primary), leg.crossCheck ? toRaw(leg.crossCheck) : null);
      expect({
        priceE18: result.priceE18.toString(),
        crossCheckE18: result.crossCheckE18.toString(),
        divergenceBps: Number(result.divergenceBps),
      }).toEqual(leg.expected);
      return result;
    });
    const quote = quoteSwap({
      amountIn: BigInt(vector.amountIn),
      decimalsIn: vector.decimalsIn,
      priceInE18: legs[0]!.priceE18,
      decimalsOut: vector.decimalsOut,
      priceOutE18: legs[1]!.priceE18,
      maxSlippageBps: vector.maxSlippageBps,
    });
    expect({
      usdValue: quote.usdValue.toString(),
      expectedOut: quote.expectedOut.toString(),
      minAmountOut: quote.minAmountOut.toString(),
    }).toEqual(vector.expected);
  });
});

describe("oracle math", () => {
  it("rejects a non-positive oracle answer, as the vault does", () => {
    expect(() => toE18({ value: 0n, decimals: 8 })).toThrow(RangeError);
    expect(() => toE18({ value: -1n, decimals: 8 })).toThrow(RangeError);
  });

  it("measures divergence against the primary price, whichever side is higher", () => {
    expect(divergenceBps(100n, 101n)).toBe(100n);
    expect(divergenceBps(100n, 99n)).toBe(100n);
    expect(divergenceBps(101n, 100n)).toBe(99n);
  });

  it("sizes a USD amount so the vault values it at or just below that amount", () => {
    const priceE18 = 102_450_000_000_000_000n;
    const usdE18 = usdToE18(10);
    const amountIn = amountForUsd(usdE18, priceE18, 8);
    const valued = (amount: bigint) =>
      quoteSwap({
        amountIn: amount,
        decimalsIn: 8,
        priceInE18: priceE18,
        decimalsOut: 6,
        priceOutE18: 10n ** 18n,
        maxSlippageBps: 0,
      }).usdValue;
    expect(valued(amountIn) <= usdE18).toBe(true);
    expect(valued(amountIn + 1n) > usdE18).toBe(true);
  });

  it("converts Supra's millisecond timestamps to seconds and leaves seconds alone", () => {
    expect(supraTimeToSeconds(1_790_881_379_188n)).toBe(1_790_881_379);
    expect(supraTimeToSeconds(1_790_881_379n)).toBe(1_790_881_379);
  });
});
