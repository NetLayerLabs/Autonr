import { type Address, getAddress, type Hex } from "viem";

/**
 * Small, dependency-free helpers for Hedera identifiers. Hedera has two parallel naming systems: native entity ids
 * (`0.0.1234`, transaction ids `0.0.1234@1727800000.123456789`) and EVM forms (`0x…` addresses, `0x…` tx hashes).
 * The Mirror Node accepts either; HashScan links and the vault's `hcsTopicNum` need the conversions below.
 */

export type HederaNetworkName = "testnet" | "mainnet" | "previewnet";

const ENTITY_ID = /^(\d+)\.(\d+)\.(\d+)$/;
const TX_ID_AT = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/;
const TX_ID_DASH = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export function isEntityId(value: string): boolean {
  return ENTITY_ID.test(value);
}

/** `0.0.1234` -> 1234n. Topics on testnet/mainnet live in shard 0 realm 0, which is what the vault stores. */
export function entityNum(entityId: string): bigint {
  const match = ENTITY_ID.exec(entityId);
  if (!match) throw new Error(`not a Hedera entity id: ${entityId}`);
  if (match[1] !== "0" || match[2] !== "0") throw new Error(`only shard 0 realm 0 is supported: ${entityId}`);
  return BigInt(match[3] as string);
}

/** 1234n -> `0.0.1234`. */
export function entityIdFromNum(num: bigint | number): string {
  return `0.0.${num.toString()}`;
}

/**
 * The "long-zero" EVM address of an entity: 0x000…00 followed by the entity number. Accounts created from an ECDSA key
 * also have an alias address derived from the key; the Mirror Node resolves both.
 */
export function longZeroAddress(entityId: string): Address {
  return getAddress(`0x${entityNum(entityId).toString(16).padStart(40, "0")}`);
}

/** Entity id behind a long-zero address, or null for alias (key-derived) addresses. */
export function entityIdFromLongZero(address: Address): string | null {
  const hex = address.toLowerCase().slice(2);
  if (!hex.startsWith("000000000000000000000000")) return null;
  return entityIdFromNum(BigInt(`0x${hex}`));
}

export function isTxHash(value: string): value is Hex {
  return TX_HASH.test(value);
}

/**
 * Normalises a Hedera transaction id to the Mirror Node path form `0.0.1234-1727800000-123456789`.
 * Accepts `0.0.1234@1727800000.123456789` (SDK form) or the dash form. Returns null for anything else.
 */
export function mirrorTransactionId(value: string): string | null {
  const at = TX_ID_AT.exec(value);
  if (at) return `${at[1]}-${at[2]}-${at[3]}`;
  return TX_ID_DASH.test(value) ? value : null;
}

/** Mirror Node consensus timestamps are strings "seconds.nanoseconds". Compare them exactly, never as floats. */
export function compareConsensusTimestamps(a: string, b: string): number {
  const [aSec = "0", aNano = "0"] = a.split(".");
  const [bSec = "0", bNano = "0"] = b.split(".");
  const seconds = BigInt(aSec) - BigInt(bSec);
  if (seconds !== 0n) return seconds < 0n ? -1 : 1;
  const nanos = BigInt(aNano.padEnd(9, "0")) - BigInt(bNano.padEnd(9, "0"));
  return nanos === 0n ? 0 : nanos < 0n ? -1 : 1;
}

/** Milliseconds between two consensus timestamps (b - a), for display. */
export function consensusDeltaMs(a: string, b: string): number {
  const toMs = (ts: string) => {
    const [sec = "0", nano = "0"] = ts.split(".");
    return Number(sec) * 1000 + Number(nano.padEnd(9, "0").slice(0, 3));
  };
  return toMs(b) - toMs(a);
}

export function consensusTimestampToDate(ts: string): Date {
  const [sec = "0", nano = "0"] = ts.split(".");
  return new Date(Number(sec) * 1000 + Number(nano.padEnd(9, "0").slice(0, 3)));
}

type HashscanKind = "transaction" | "contract" | "topic" | "account" | "token";

/** Deep link into HashScan. Transactions accept a 0x hash or a Hedera transaction id. */
export function hashscanUrl(network: HederaNetworkName, kind: HashscanKind, id: string): string {
  return `https://hashscan.io/${network}/${kind}/${encodeURIComponent(id)}`;
}

/** Deep link to one HCS message. */
export function hashscanTopicMessageUrl(
  network: HederaNetworkName,
  topicId: string,
  sequence: number,
  consensusTimestamp?: string | null,
): string {
  // HashScan shows a message under the transaction that submitted it, addressed by consensus timestamp; it has no
  // per-sequence route. Without the timestamp, link the topic's message list, where the sequence number is listed.
  return consensusTimestamp
    ? `https://hashscan.io/${network}/transaction/${consensusTimestamp}/message`
    : `https://hashscan.io/${network}/topic/${topicId}/messages#${sequence}`;
}
