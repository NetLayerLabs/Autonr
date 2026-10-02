import { type Address } from "viem";
import { describe, expect, it } from "vitest";
import { NETWORKS, type TokenRef } from "../../src/networks";
import { type PoolState } from "../../src/saucerswap/pool";
import { poolPriceE18, poolPriceUsd, spotAmountOut } from "../../src/saucerswap/price";

const { baseToken: whbar, quoteToken: usdc } = NETWORKS.testnet;
const Q96 = 1n << 96n;
const Q192 = 1n << 192n;

/** Integer square root by Newton's method, to build the exact sqrtPriceX96 of a chosen price. */
function isqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let root = value;
  let next = (root + 1n) / 2n;
  while (next < root) {
    root = next;
    next = (root + value / root) / 2n;
  }
  return root;
}

/** Testnet pool 0.0.9283328 (fee 3000) as read on 2026-10-01: token0 USDC (6 dp), token1 WHBAR (8 dp). */
const livePool: PoolState = {
  pool: "0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a",
  token0: usdc.address,
  token1: whbar.address,
  fee: 3000,
  sqrtPriceX96: 558137174853493522622439261990n,
  tick: 39_047,
  liquidity: 125_349_437_318n,
};

describe("poolPriceE18", () => {
  // Expected values computed independently with `bc -l` at 40 digits, then truncated to 18 decimals.
  it("prices WHBAR in USDC from the live testnet pool (WHBAR is token1)", () => {
    expect(poolPriceE18(livePool, whbar, usdc)).toBe(2_015010288495966455n);
  });

  it("prices USDC in WHBAR from the same pool (USDC is token0)", () => {
    expect(poolPriceE18(livePool, usdc, whbar)).toBe(496275381673815085n);
  });

  it("scales a raw 1:1 price by the decimals difference", () => {
    const parity = { ...livePool, sqrtPriceX96: Q96 };
    // One raw unit of token1 per raw unit of token0: 1 USDC (1e6 raw) buys 1e6 raw WHBAR = 0.01 WHBAR.
    expect(poolPriceE18(parity, usdc, whbar)).toBe(10n ** 16n);
    expect(poolPriceE18(parity, whbar, usdc)).toBe(100n * 10n ** 18n);
  });

  it("round-trips a price through sqrtPriceX96", () => {
    for (const priceE18 of [102_450_000_000_000_000n, 2_015_010_288_495_966_455n, 61_234_500_000_000_000_000_000n]) {
      // WHBAR is token1, so priceE18 = 2^192 * 10^(8 + 18) / (sqrtPriceX96^2 * 10^6), solved for sqrtPriceX96.
      const sqrtPriceX96 = isqrt((Q192 * 10n ** 20n) / priceE18);
      expect(poolPriceE18({ ...livePool, sqrtPriceX96 }, whbar, usdc)).toBe(priceE18);
    }
  });

  it("refuses a pair the pool does not trade", () => {
    const other: TokenRef = {
      ...usdc,
      symbol: "OTHER",
      address: "0x0000000000000000000000000000000000abcdef" as Address,
    };
    expect(() => poolPriceE18(livePool, whbar, other)).toThrow(/does not trade WHBAR\/OTHER/);
  });
});

describe("poolPriceUsd", () => {
  it("converts the pool price to USD with the quote token's oracle price (about $2.01 on testnet)", () => {
    expect(poolPriceUsd(livePool, whbar, usdc, 0.99997)).toBeCloseTo(2.0149498, 6);
  });
});

describe("spotAmountOut", () => {
  it("sells WHBAR (token1) for USDC at the pool price minus the 0.30% fee", () => {
    // 1 WHBAR buys 2.015010 USDC at the pool price (rounded down), less 0.30%: 2.008964 USDC.
    expect(spotAmountOut(livePool, whbar.address, 100_000_000n)).toBe(2_008_964n);
  });

  it("sells USDC (token0) for WHBAR at the inverse price minus the fee", () => {
    // 1 USDC buys 0.49627538 WHBAR at the pool price, less 0.30%: 0.49478655 WHBAR.
    expect(spotAmountOut(livePool, usdc.address, 1_000_000n)).toBe(49_478_655n);
  });

  it("pays a parity pool's raw amount less the fee", () => {
    const parity = { ...livePool, sqrtPriceX96: Q96 };
    expect(spotAmountOut(parity, usdc.address, 1_000_000n)).toBe(997_000n);
    expect(spotAmountOut(parity, whbar.address, 1_000_000n)).toBe(997_000n);
  });
});
