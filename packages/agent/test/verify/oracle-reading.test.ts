import { describe, expect, it } from "vitest";
import { TRACE_SELECTORS } from "../../src/verify";
import { oracleReading } from "../../src/verify/oracle-reading";
import vectors from "../../../foundry/test/vectors/oracle-math.json";

const UPDATED_AT = 1_790_000_000n;
/** Supra on Hedera reports milliseconds. */
const SUPRA_TIME_MS = 1_790_000_000_123n;

type Leg = (typeof vectors)[number]["oracleIn"];

describe("oracleReading against the shared oracle-math vectors", () => {
  const legs = vectors.flatMap(vector => [
    { name: `${vector.name}, tokenIn`, leg: vector.oracleIn as Leg },
    { name: `${vector.name}, tokenOut`, leg: vector.oracleOut as Leg },
  ]);

  it.each(legs)("recomputes the vault's reading: $name", ({ leg }) => {
    const chainlink = { answer: BigInt(leg.primary.value), updatedAt: UPDATED_AT, decimals: leg.primary.decimals };
    const supra = leg.crossCheck && {
      price: BigInt(leg.crossCheck.value),
      decimals: BigInt(leg.crossCheck.decimals),
      time: SUPRA_TIME_MS,
    };

    expect(oracleReading(chainlink, supra)).toEqual({
      priceE18: leg.expected.priceE18,
      updatedAt: Number(UPDATED_AT),
      crossCheckE18: leg.expected.crossCheckE18,
      crossCheckUpdatedAt: supra ? Number(SUPRA_TIME_MS / 1000n) : 0,
      divergenceBps: leg.expected.divergenceBps,
    });
  });

  it.each(legs.filter(({ leg }) => leg.crossCheck === null))("prices a Supra-only token alone: $name", ({ leg }) => {
    const supra = { price: BigInt(leg.primary.value), decimals: BigInt(leg.primary.decimals), time: SUPRA_TIME_MS };
    expect(oracleReading(null, supra)).toEqual({
      priceE18: leg.expected.priceE18,
      updatedAt: 1_790_000_000,
      crossCheckE18: "0",
      crossCheckUpdatedAt: 0,
      divergenceBps: 0,
    });
  });
});

describe("oracleReading edge cases", () => {
  it("keeps a Supra time that is already in seconds", () => {
    expect(oracleReading(null, { price: 99_997_000n, decimals: 8n, time: 1_790_000_000n })?.updatedAt).toBe(
      1_790_000_000,
    );
  });

  it("has no reading without a positive price, as the vault would refuse", () => {
    expect(oracleReading({ answer: 0n, updatedAt: UPDATED_AT, decimals: 8 }, null)).toBeNull();
    expect(oracleReading({ answer: -1n, updatedAt: UPDATED_AT, decimals: 8 }, null)).toBeNull();
    expect(oracleReading(null, { price: 0n, decimals: 8n, time: SUPRA_TIME_MS })).toBeNull();
    expect(oracleReading(null, null)).toBeNull();
  });
});

describe("TRACE_SELECTORS", () => {
  it("are the selectors the vault calls (Chainlink, Supra, SaucerSwap V2 router)", () => {
    expect(TRACE_SELECTORS).toEqual({
      chainlinkLatestRoundData: "0xfeaf968c",
      supraGetSvalue: "0x89b94ea2",
      saucerswapExactInput: "0xc04b8d59",
    });
  });
});
