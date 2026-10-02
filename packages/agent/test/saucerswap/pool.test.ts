import { BaseError, HttpRequestError, RpcRequestError } from "viem";
import { describe, expect, it, vi } from "vitest";
import { type ReadOnlyConfig } from "../../src/config";
import { NETWORKS } from "../../src/networks";
import { type PoolState, quotePool, type QuoteReads } from "../../src/saucerswap/pool";

const { baseToken: whbar, quoteToken: usdc } = NETWORKS.testnet;

// The endpoints are unreachable on purpose: every chain read goes through the fakes below.
const cfg: ReadOnlyConfig = {
  network: "testnet",
  rpcUrl: "http://127.0.0.1:1",
  mirrorUrl: "http://127.0.0.1:1",
  vaultAddress: null,
  topicId: null,
  agentAccountId: null,
  agentAddress: null,
  baseToken: whbar,
  quoteToken: usdc,
  poolFee: 3000,
  tickApiEnabled: false,
};

/** The live testnet pool (token0 USDC, token1 WHBAR), as in price.test.ts. */
const livePool: PoolState = {
  pool: "0x914B98992d7eD602D1f5d9084ECe8160Fc0e741a",
  token0: usdc.address,
  token1: whbar.address,
  fee: 3000,
  sqrtPriceX96: 558137174853493522622439261990n,
  tick: 39_047,
  liquidity: 125_349_437_318n,
};

const sellOneWhbar = { tokenIn: whbar.address, tokenOut: usdc.address, fee: 3000, amountIn: 100_000_000n };

/** What mainnet's relay answers for every QuoterV2 call: its Mirror Node refuses the simulation. */
const refusedSimulation = new HttpRequestError({
  url: "https://mainnet.hashio.io/api",
  status: 400,
  details: "Error occurred during transaction simulation: Invalid request",
});

/** A quoter revert as the relay reports it: execution reverted, with the revert data. */
const quoterRevert = new BaseError("Execution reverted.", {
  cause: new RpcRequestError({ body: {}, error: { code: 3, message: "execution reverted", data: "0x" }, url: "relay" }),
});

function reads(quoter: QuoteReads["quoter"], state: PoolState | null = livePool) {
  return { quoter: vi.fn(quoter), poolState: vi.fn(async () => state) } satisfies QuoteReads;
}

describe("quotePool", () => {
  it("returns SaucerSwap's quote when the quoter answers", async () => {
    const fakes = reads(async () => 2_000_000n);
    await expect(quotePool(cfg, sellOneWhbar, fakes)).resolves.toEqual({ amountOut: 2_000_000n, source: "quoter" });
    expect(fakes.poolState).not.toHaveBeenCalled();
  });

  it("estimates from the spot price when the node refuses to run the quoter", async () => {
    const fakes = reads(async () => {
      throw refusedSimulation;
    });
    // 1 WHBAR at the pool price, less the 0.30% fee (see spotAmountOut in price.test.ts).
    await expect(quotePool(cfg, sellOneWhbar, fakes)).resolves.toEqual({ amountOut: 2_008_964n, source: "spot" });
    expect(fakes.poolState).toHaveBeenCalledWith({ tokenA: whbar.address, tokenB: usdc.address, fee: 3000 });
  });

  it("passes a quoter revert on: that is SaucerSwap's own answer", async () => {
    const fakes = reads(async () => {
      throw quoterRevert;
    });
    await expect(quotePool(cfg, sellOneWhbar, fakes)).rejects.toBe(quoterRevert);
    expect(fakes.poolState).not.toHaveBeenCalled();
  });

  it("names the missing pool when there is nothing to estimate from", async () => {
    const fakes = reads(async () => {
      throw refusedSimulation;
    }, null);
    await expect(quotePool(cfg, sellOneWhbar, fakes)).rejects.toThrow(
      "SaucerSwap V2 has no initialized WHBAR/USDC pool at the 0.30% fee tier. Check AUTONR_POOL_FEE.",
    );
  });
});
