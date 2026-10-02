import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Hex,
  hexToString,
  isHex,
  RpcRequestError,
} from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { formatUsdE18 } from "../oracles/math";
import { solidityErrorsAbi, vaultImplementationErrorsAbi } from "./abi";

export type VaultError = { name: string; detail: string };

const revertAbi = [...agentVaultAbi, ...vaultImplementationErrorsAbi, ...solidityErrorsAbi];

/** JSON-RPC error code for "execution reverted" (EIP-1474); the relay puts the revert data next to it. */
const EXECUTION_REVERTED = 3;

/**
 * Hedera answers some failures with the name of a network status instead of ABI-encoded revert data, e.g. the bytes
 * of "INVALID_ACCOUNT_ID" when a system contract rejects an account.
 */
const HEDERA_STATUS = /^[A-Z][A-Z0-9_]{2,63}$/;

/**
 * The raw revert data carried by a viem error, "0x" for a revert without data, or undefined when the error is not a
 * revert at all (a network failure, a relay precheck such as "Sender account not found"). Callers must never record
 * the latter as a vault rejection, so anything without revert data or an execution-reverted code counts as one.
 */
export function revertDataOf(error: unknown): Hex | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk(cause => cause instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError && reverted.raw !== undefined) return reverted.raw;
  const rpc = error.walk(cause => cause instanceof RpcRequestError && cause.code === EXECUTION_REVERTED);
  if (rpc instanceof RpcRequestError) return isHex(rpc.data) ? rpc.data : "0x";
  return undefined;
}

/** Names a revert the way the decision log records it, with a one-line human explanation. */
export function decodeRevertData(data: Hex): VaultError {
  if (data === "0x") return { name: "Unknown", detail: "reverted without a reason" };
  try {
    return describe(decodeErrorResult({ abi: revertAbi, data }));
  } catch {
    const text = hederaStatus(data);
    if (text) return { name: text, detail: `Hedera rejected the call with status ${text}` };
    return { name: "Unknown", detail: `unrecognised revert selector ${data.slice(0, 10)}` };
  }
}

/** Decodes any error thrown by a vault call: custom errors, OpenZeppelin errors, Error(string), Hedera statuses. */
export function decodeVaultError(error: unknown): VaultError {
  const data = revertDataOf(error);
  if (data !== undefined) return decodeRevertData(data);
  const message =
    error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error);
  return { name: "Unknown", detail: message };
}

function hederaStatus(data: Hex): string | null {
  try {
    const text = hexToString(data);
    return HEDERA_STATUS.test(text) ? text : null;
  } catch {
    return null;
  }
}

function at(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString().replace(".000Z", "Z");
}

type Decoded = ReturnType<typeof decodeErrorResult<typeof revertAbi>>;

function describe(decoded: Decoded): VaultError {
  const name = decoded.errorName;
  const detail = (() => {
    switch (decoded.errorName) {
      case "NotAgent":
        return `caller ${decoded.args[0]} is not the vault's agent`;
      case "ZeroAddress":
        return "an address argument is the zero address";
      case "TokenNotAllowed":
        return `token ${decoded.args[0]} is not allowed by the vault`;
      case "InvalidPair":
        return "tokenIn and tokenOut are the same token";
      case "ZeroAmount":
        return "the trade is zero or too small to price";
      case "InvalidPolicy":
        return "the policy values are out of range";
      case "UnsupportedDecimals":
        return `tokens with ${decoded.args[0]} decimals are not supported (at most 18)`;
      case "NoPriceSource":
        return "the token needs a Chainlink feed or an enabled Supra pair";
      case "DecisionTopicNotSet":
        return "the vault has no HCS decision topic, so trading is disabled";
      case "ReasoningRequired":
        return "the trade does not reference published reasoning (zero hash)";
      case "ReasoningOutOfOrder":
        return `reasoning sequence ${decoded.args[0]} is not after the last traded sequence ${decoded.args[1]}`;
      case "TradeTooLarge":
        return `trade ${formatUsdE18(decoded.args[0])} exceeds the per-trade cap ${formatUsdE18(decoded.args[1])}`;
      case "DailyCapExceeded":
        return `trade ${formatUsdE18(decoded.args[0])} exceeds the ${formatUsdE18(decoded.args[1])} left in today's cap`;
      case "CooldownActive":
        return `the cooldown runs until ${at(decoded.args[0])}`;
      case "InvalidOraclePrice":
        return `an oracle returned no valid price for ${decoded.args[0]}`;
      case "StalePrice":
        return `the price for ${decoded.args[0]} dates from ${at(decoded.args[1])}, older than ${decoded.args[2]} s`;
      case "OracleDivergence":
        return `Chainlink and Supra differ by ${decoded.args[1]} bps for ${decoded.args[0]} (limit ${decoded.args[2]} bps)`;
      case "InsufficientOutput":
        return `the swap returned ${decoded.args[0]}, below the oracle-derived minimum ${decoded.args[1]}`;
      case "PoolFeeNotAllowed":
        return `fee tier ${decoded.args[0]} is not the one the owner approved for this pair`;
      case "HtsAssociationFailed":
        return `HTS association with ${decoded.args[0]} failed with response code ${decoded.args[1]}`;
      case "EnforcedPause":
        return "the vault is paused";
      case "ExpectedPause":
        return "the vault is not paused";
      case "ReentrancyGuardReentrantCall":
        return "a reentrant call was blocked";
      case "OwnableUnauthorizedAccount":
        return `${decoded.args[0]} is not the vault owner`;
      case "OwnableInvalidOwner":
        return `${decoded.args[0]} cannot own the vault`;
      case "SafeERC20FailedOperation":
        return `token ${decoded.args[0]} rejected the transfer or approval`;
      case "OwnershipCannotBeRenounced":
        return "the vault cannot be left without an owner: nobody could withdraw its tokens";
      case "Error":
        return decoded.args[0];
      case "Panic":
        return `Solidity panic 0x${decoded.args[0].toString(16)}`;
    }
  })();
  return { name, detail };
}
