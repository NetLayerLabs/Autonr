import { type Address, getAddress, isAddress } from "viem";
import { isEntityId, isTxHash, mirrorTransactionId } from "../hedera";
import { MirrorClient } from "../mirror";
import { getNetwork, isNetworkName, type NetworkName } from "../networks";
import { VerifyError } from "./errors";

export const DEFAULT_LIST_LIMIT = 25;
const MAX_LIMIT = 1000;

export function mirrorFor(network: NetworkName, mirrorUrl?: string): MirrorClient {
  if (!isNetworkName(network)) {
    throw new VerifyError("invalid-input", `unknown network "${network}"; use testnet or mainnet`);
  }
  return new MirrorClient({ baseUrl: mirrorUrl ?? getNetwork(network).mirrorUrl });
}

/** An EVM transaction hash as is, or a Hedera transaction id in the Mirror Node's `0.0.x-sss-nnn` form. */
export function transactionReference(tx: string): string {
  const value = tx.trim();
  if (isTxHash(value)) return value.toLowerCase();
  const id = mirrorTransactionId(value);
  if (id) return id;
  const expected = "an EVM transaction hash (0x + 64 hex) nor a Hedera transaction id (0.0.1234@1700000000.123456789)";
  throw new VerifyError("invalid-input", `"${tx}" is neither ${expected}`);
}

export function topicIdInput(topicId: string): string {
  if (!isEntityId(topicId)) throw new VerifyError("invalid-input", `"${topicId}" is not a topic id like 0.0.1234`);
  return topicId;
}

export function addressInput(value: string, label: string): Address {
  if (!isAddress(value, { strict: false })) {
    throw new VerifyError("invalid-input", `${label} "${value}" is not an EVM address`);
  }
  return getAddress(value);
}

export function limitInput(limit: number | undefined, fallback: number): number {
  const value = limit ?? fallback;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new VerifyError("invalid-input", `limit must be an integer from 1 to ${MAX_LIMIT}, got ${value}`);
  }
  return value;
}

export function sequenceInput(sequence: number): number {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new VerifyError("invalid-input", `sequence must be a positive integer, got ${sequence}`);
  }
  return sequence;
}
