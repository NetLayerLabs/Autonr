import {
  type AbiParameter,
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  type Hex,
  HttpRequestError,
  RpcRequestError,
  stringToHex,
  zeroHash,
} from "viem";
import { describe, expect, it } from "vitest";
import { agentVaultAbi } from "../src/abi/agentVault";
import { solidityErrorsAbi, vaultImplementationErrorsAbi } from "../src/vault/abi";
import { decodeRevertData, decodeVaultError, revertDataOf } from "../src/vault/errors";

const abi = [...agentVaultAbi, ...vaultImplementationErrorsAbi, ...solidityErrorsAbi];
const E18 = 10n ** 18n;
const TOKEN = "0x0000000000000000000000000000000000003aD2";

/** How viem reports a revert from simulateContract. */
function contractRevert(data: Hex): ContractFunctionExecutionError {
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: agentVaultAbi, data, functionName: "executeSwap" }),
    {
      abi: agentVaultAbi,
      functionName: "executeSwap",
      args: [
        { tokenIn: TOKEN, tokenOut: TOKEN, poolFee: 3000, amountIn: 1n },
        { hash: zeroHash, sequence: 1n },
      ],
    },
  );
}

/** How viem reports a revert from estimateGas: the relay's JSON-RPC error carries the revert data. */
function relayRevert(data: Hex): BaseError {
  const rpc = new RpcRequestError({ body: {}, error: { code: 3, message: "execution reverted", data }, url: "relay" });
  return new BaseError("Execution reverted.", { cause: rpc });
}

const encode = (errorName: string, args: readonly unknown[] = []) =>
  encodeErrorResult({ abi, errorName, args } as Parameters<typeof encodeErrorResult>[0]);

describe("decodeVaultError", () => {
  it.each([
    ["TradeTooLarge", [25n * E18, 10n * E18], "trade $25.00 exceeds the per-trade cap $10.00"],
    ["DailyCapExceeded", [5n * E18, 2n * E18], "trade $5.00 exceeds the $2.00 left in today's cap"],
    ["ReasoningOutOfOrder", [5n, 7n], "reasoning sequence 5 is not after the last traded sequence 7"],
    ["ReasoningRequired", [], "the trade does not reference published reasoning (zero hash)"],
    ["CooldownActive", [1_790_000_000n], "the cooldown runs until 2026-09-21T14:13:20Z"],
    [
      "StalePrice",
      [TOKEN, 1_790_000_000n, 3_600n],
      `the price for ${TOKEN} dates from 2026-09-21T14:13:20Z, older than 3600 s`,
    ],
    ["OracleDivergence", [TOKEN, 150n, 100n], `Chainlink and Supra differ by 150 bps for ${TOKEN} (limit 100 bps)`],
    ["TokenNotAllowed", [TOKEN], `token ${TOKEN} is not allowed by the vault`],
    ["EnforcedPause", [], "the vault is paused"],
    ["ReentrancyGuardReentrantCall", [], "a reentrant call was blocked"],
    ["Error", ["Too little received"], "Too little received"],
    ["Panic", [0x11n], "Solidity panic 0x11"],
  ] as const)("names %s and explains it", (name, args, detail) => {
    const data = encode(name, args);
    expect(decodeVaultError(contractRevert(data))).toEqual({ name, detail });
    expect(decodeVaultError(relayRevert(data))).toEqual({ name, detail });
  });

  it("describes every custom error the vault can raise", () => {
    const errors = [...agentVaultAbi, ...vaultImplementationErrorsAbi].filter(item => item.type === "error");
    for (const error of errors) {
      const decoded = decodeRevertData(encode(error.name, error.inputs.map(sampleValue)));
      expect(decoded.name).toBe(error.name);
      expect(decoded.detail.length).toBeGreaterThan(0);
      expect(decoded.detail.length).toBeLessThanOrEqual(200);
    }
  });

  it("reads Hedera status names that system contracts return instead of ABI-encoded errors", () => {
    expect(decodeRevertData(stringToHex("INVALID_ACCOUNT_ID"))).toEqual({
      name: "INVALID_ACCOUNT_ID",
      detail: "Hedera rejected the call with status INVALID_ACCOUNT_ID",
    });
  });

  it("reports unknown selectors and empty reverts as Unknown", () => {
    expect(decodeRevertData("0xdeadbeef")).toEqual({
      name: "Unknown",
      detail: "unrecognised revert selector 0xdeadbeef",
    });
    expect(decodeRevertData("0x")).toEqual({ name: "Unknown", detail: "reverted without a reason" });
  });

  it("does not mistake a network failure for a revert", () => {
    const failure = new HttpRequestError({ url: "https://relay.example", status: 503, details: "Service Unavailable" });
    expect(revertDataOf(failure)).toBeUndefined();
    expect(decodeVaultError(failure).name).toBe("Unknown");
    expect(revertDataOf(new Error("plain"))).toBeUndefined();
  });

  it("does not mistake a relay precheck for a revert", () => {
    // Hedera's relay refuses to simulate calls from addresses that have no account.
    const precheck = new RpcRequestError({
      body: {},
      error: { code: -32000, message: "Error occurred during transaction simulation: Sender account not found." },
      url: "relay",
    });
    expect(revertDataOf(new BaseError("Call failed.", { cause: precheck }))).toBeUndefined();
  });
});

function sampleValue(parameter: AbiParameter): unknown {
  if (parameter.type === "address") return TOKEN;
  if (parameter.type.startsWith("int")) return -1n;
  if (parameter.type.startsWith("uint")) return 1n;
  if (parameter.type === "bool") return true;
  return "0x";
}
