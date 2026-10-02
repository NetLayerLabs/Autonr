import {
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  getAbiItem,
  type Hex,
  type Log,
  type TransactionReceipt,
  zeroHash,
} from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentVaultAbi } from "../src/abi/agentVault";
import { type HederaPublicClient, type HederaWalletClient } from "../src/chain";
import { executeSwap } from "../src/vault/execute";
import { type SwapCall } from "../src/vault/simulate";
import { AGENT_ADDRESS, usdc, VAULT_ADDRESS, whbar } from "./fixtures";

const TX_HASH: Hex = `0x${"cd".repeat(32)}`;
const MIRROR = "https://mirror.test";
const call: SwapCall = {
  vault: VAULT_ADDRESS,
  request: { tokenIn: whbar.address, tokenOut: usdc.address, poolFee: 3000, amountIn: 4_880_429_477n },
  reasoning: { hash: `0x${"ef".repeat(32)}`, sequence: 42n },
};

/** Just enough of viem's clients for executeSwap: an estimate, a gas price, a send and a receipt. */
function clients(receipt: Pick<TransactionReceipt, "status" | "logs">) {
  const client = {
    estimateGas: vi.fn(async () => 400_000n),
    getGasPrice: vi.fn(async () => 860_000_000_000n),
    waitForTransactionReceipt: vi.fn(async () => receipt),
  };
  const wallet = { account: { address: AGENT_ADDRESS }, sendTransaction: vi.fn(async () => TX_HASH) };
  return {
    client: client as unknown as HederaPublicClient,
    wallet: wallet as unknown as HederaWalletClient,
    send: wallet.sendTransaction,
  };
}

function tradeExecutedLog(): Log<bigint, number, false> {
  const event = getAbiItem({ abi: agentVaultAbi, name: "TradeExecuted" });
  const reading = { priceE18: 1n, updatedAt: 1n, crossCheckE18: 0n, crossCheckUpdatedAt: 0n, divergenceBps: 0n };
  const receipt = {
    amountIn: call.request.amountIn,
    amountOut: 4_997_559n,
    minAmountOut: 4_850_145n,
    usdValue: 5n * 10n ** 18n,
    oracleIn: reading,
    oracleOut: reading,
    reasoningHash: call.reasoning.hash,
    hcsTopicNum: 5005n,
    hcsSequence: 42n,
  };
  return {
    address: VAULT_ADDRESS,
    topics: encodeEventTopics({
      abi: agentVaultAbi,
      eventName: "TradeExecuted",
      args: { tradeId: 7n, tokenIn: whbar.address, tokenOut: usdc.address },
    }) as Log["topics"],
    data: encodeAbiParameters([event.inputs[3]], [receipt]),
    blockHash: zeroHash,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    removed: false,
  };
}

/** The Mirror Node's record of the reverted transaction, as GET /api/v1/contracts/results/{hash} serves it. */
function revertedResult(errorMessage: string | null) {
  return {
    address: VAULT_ADDRESS,
    block_number: 41_233_020,
    contract_id: "0.0.7000001",
    error_message: errorMessage,
    from: "0x0000000000000000000000000000000000001389",
    function_parameters: "0x",
    hash: TX_HASH,
    result: "CONTRACT_REVERT_EXECUTED",
    timestamp: "1790000010.000000001",
    logs: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("executeSwap", () => {
  it("sends a legacy transaction with 30% gas headroom and reads the TradeExecuted event", async () => {
    const { client, wallet, send } = clients({ status: "success", logs: [tradeExecutedLog()] });
    const result = await executeSwap(client, wallet, call, MIRROR);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: VAULT_ADDRESS, gas: 520_000n, type: "legacy" }));
    expect(result).toEqual({
      ok: true,
      txHash: TX_HASH,
      tradeId: 7,
      amountIn: call.request.amountIn,
      amountOut: 4_997_559n,
    });
  });

  it("decodes an on-chain revert from the Mirror Node's contract result", async () => {
    const errorMessage = encodeErrorResult({
      abi: agentVaultAbi,
      errorName: "InsufficientOutput",
      args: [4_000_000n, 4_850_145n],
    });
    const fetch = vi.fn(async () => Response.json(revertedResult(errorMessage)));
    vi.stubGlobal("fetch", fetch);
    const { client, wallet } = clients({ status: "reverted", logs: [] });

    expect(await executeSwap(client, wallet, call, MIRROR)).toEqual({
      ok: false,
      txHash: TX_HASH,
      error: {
        name: "InsufficientOutput",
        detail: "the swap returned 4000000, below the oracle-derived minimum 4850145",
      },
    });
    expect(fetch).toHaveBeenCalledWith(`${MIRROR}/api/v1/contracts/results/${TX_HASH}`, expect.anything());
  });

  it("waits for the Mirror Node to import the reverted transaction", async () => {
    vi.useFakeTimers();
    const errorMessage = encodeErrorResult({ abi: agentVaultAbi, errorName: "CooldownActive", args: [1_790_000_060n] });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ _status: { messages: [{ message: "Not found" }] } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json(revertedResult(errorMessage)));
    vi.stubGlobal("fetch", fetch);
    const { client, wallet } = clients({ status: "reverted", logs: [] });

    const pending = executeSwap(client, wallet, call, MIRROR);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: false, error: { name: "CooldownActive" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("still reports the revert when the Mirror Node cannot say why", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    const { client, wallet } = clients({ status: "reverted", logs: [] });

    const pending = executeSwap(client, wallet, call, MIRROR);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({
      ok: false,
      txHash: TX_HASH,
      error: { name: "Unknown", detail: "reverted; the Mirror Node did not return the revert data (HTTP 503)" },
    });
  });
});
