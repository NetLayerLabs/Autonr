import { type Hex, keccak256, toBytes } from "viem";
import { z } from "zod";

/**
 * The decision record is the agent's published reasoning. One record is one HCS message.
 *
 * The vault never sees this JSON. It only receives `keccak256(bytes)` and the HCS sequence number, and emits both in
 * `TradeExecuted`. A verifier re-downloads the message from the Mirror Node, re-hashes the exact bytes and compares.
 * That is why the bytes, not a re-serialisation, are what get hashed: never pretty-print or re-order a record after
 * it has been encoded.
 */
export const DECISION_SCHEMA_ID = "autonr.decision/v1";

/** HCS splits messages larger than 1024 bytes into chunks with separate sequence numbers. We keep one chunk. */
export const MAX_DECISION_BYTES = 1024;

/** Field limits of the record, shared with the callers that fill the fields so they never overrun the schema. */
export const MAX_RATIONALE_LENGTH = 400;
export const MAX_MODEL_LENGTH = 48;
export const MAX_REJECTION_ERROR_LENGTH = 64;
export const MAX_REJECTION_DETAIL_LENGTH = 200;

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address");
const uintString = z.string().regex(/^\d+$/, "expected an unsigned integer as a decimal string");
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "expected a decimal number as a string");
const hederaEntityId = z.string().regex(/^\d+\.\d+\.\d+$/, "expected a Hedera entity id like 0.0.1234");

export const priceObservationSchema = z.object({
  /** Human label of the price, e.g. "HBAR/USD". */
  feed: z.string().min(1).max(16),
  /** Which oracle network priced it. */
  source: z.enum(["chainlink", "supra"]),
  price: decimalString,
  /** Oracle update time, unix seconds. */
  updatedAt: z.number().int().nonnegative(),
  /** Supra's price for the same asset when it cross-checks Chainlink. */
  crossCheck: decimalString.optional(),
  divergenceBps: z.number().int().nonnegative().optional(),
});

export const tradeActionSchema = z.object({
  /** Direction relative to the vault's base asset (HBAR): buy = spend the quote token to get WHBAR. */
  side: z.enum(["buy", "sell"]),
  tokenIn: hexAddress,
  tokenOut: hexAddress,
  /** Exact amount of tokenIn, smallest unit. Must equal the amountIn the vault later emits. */
  amountIn: uintString,
  poolFee: z.number().int().positive(),
  /** Approximate USD notional at decision time. Informational; the vault computes its own. */
  usd: decimalString,
});

const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hash");

/**
 * Everything needed to re-run the refused call: with `action` it rebuilds the exact executeSwap calldata, and the Mirror
 * Node can execute it again at `block`. A verifier that gets the same custom error has reproduced the rejection.
 */
export const replaySchema = z.object({
  block: z.number().int().nonnegative(),
  from: hexAddress,
  reasoningHash: hash32,
  sequence: z.number().int().nonnegative(),
});

export const rejectionSchema = z.object({
  /** "simulation": the vault refused a dry run, so nothing was sent. "execution": the real transaction reverted. */
  stage: z.enum(["simulation", "execution"]),
  /** Custom error name from IAgentVault (e.g. "DailyCapExceeded"), a router error, or "Unknown". */
  error: z.string().min(1).max(MAX_REJECTION_ERROR_LENGTH),
  detail: z.string().max(MAX_REJECTION_DETAIL_LENGTH),
  /** For execution-stage rejections: the sequence number of the "trade" record this refers to. */
  decisionSeq: z.number().int().positive().optional(),
  /** For execution-stage rejections: the reverted transaction. */
  txHash: hash32.optional(),
  /** For simulation-stage rejections: how to replay the refused call. */
  replay: replaySchema.optional(),
});

export const decisionKinds = ["trade", "hold", "rejected"] as const;
export type DecisionKind = (typeof decisionKinds)[number];

export const decisionRecordSchema = z
  .object({
    schema: z.literal(DECISION_SCHEMA_ID),
    kind: z.enum(decisionKinds),
    network: z.enum(["testnet", "mainnet", "previewnet", "local"]),
    vault: hexAddress,
    /** Hedera account id of the agent, which is also the HCS topic's submit key holder. */
    agent: hederaEntityId,
    /** ISO-8601 time the agent made the decision. */
    createdAt: z.iso.datetime(),
    strategy: z.object({
      id: z.string().min(1).max(32),
      version: z.string().min(1).max(16),
      model: z.string().max(MAX_MODEL_LENGTH).optional(),
    }),
    market: z.array(priceObservationSchema).max(2),
    action: tradeActionSchema.optional(),
    rationale: z.string().max(MAX_RATIONALE_LENGTH),
    rejection: rejectionSchema.optional(),
  })
  .superRefine((record, ctx) => {
    if (record.kind === "trade" && !record.action) {
      ctx.addIssue({ code: "custom", path: ["action"], message: "a trade record needs an action" });
    }
    if (record.kind === "trade" && record.rejection) {
      ctx.addIssue({ code: "custom", path: ["rejection"], message: "a trade record cannot carry a rejection" });
    }
    if (record.kind === "hold" && (record.action || record.rejection)) {
      ctx.addIssue({ code: "custom", path: ["kind"], message: "a hold record has neither action nor rejection" });
    }
    if (record.kind === "rejected" && !record.rejection) {
      ctx.addIssue({ code: "custom", path: ["rejection"], message: "a rejected record needs a rejection" });
    }
  });

export type PriceObservation = z.infer<typeof priceObservationSchema>;
export type TradeAction = z.infer<typeof tradeActionSchema>;
export type Rejection = z.infer<typeof rejectionSchema>;
export type Replay = z.infer<typeof replaySchema>;
export type DecisionRecord = z.infer<typeof decisionRecordSchema>;

export type EncodedDecision = {
  record: DecisionRecord;
  /** The exact string submitted to HCS. */
  json: string;
  /** UTF-8 bytes of `json`; this is what gets hashed. */
  bytes: Uint8Array;
  /** keccak256(bytes), passed to the vault as `reasoning.hash`. */
  hash: Hex;
};

export class DecisionTooLargeError extends Error {
  constructor(readonly size: number) {
    super(`decision record is ${size} bytes; HCS single-chunk limit is ${MAX_DECISION_BYTES}`);
    this.name = "DecisionTooLargeError";
  }
}

/**
 * Validates a record and produces the canonical bytes to publish. Keys follow the schema order, so the same record
 * always encodes to the same bytes.
 */
export function encodeDecision(input: DecisionRecord): EncodedDecision {
  const record = decisionRecordSchema.parse(input);
  const json = JSON.stringify(record);
  const bytes = toBytes(json);
  if (bytes.length > MAX_DECISION_BYTES) throw new DecisionTooLargeError(bytes.length);
  return { record, json, bytes, hash: keccak256(bytes) };
}

export type DecodedDecision = { ok: true; record: DecisionRecord; hash: Hex } | { ok: false; error: string; hash: Hex };

/** Parses raw HCS message bytes. Never throws: a malformed message is reported, not hidden. */
export function decodeDecision(bytes: Uint8Array): DecodedDecision {
  const hash = keccak256(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, error: "message is not valid JSON", hash };
  }
  const result = decisionRecordSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: z.prettifyError(result.error), hash };
  }
  return { ok: true, record: result.data, hash };
}

const ELLIPSIS = "…";
const utf8 = new TextEncoder();

/**
 * Collapses whitespace and cuts a rationale to at most `max` UTF-16 code units (the unit the schema's length limit
 * counts), never splitting a surrogate pair. Returns "" when `max` leaves no room for any text.
 */
export function clampRationale(text: string, max = MAX_RATIONALE_LENGTH): string {
  if (max < 1) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  let kept = "";
  for (const codePoint of clean) {
    if (kept.length + codePoint.length > max - ELLIPSIS.length) break;
    kept += codePoint;
  }
  return `${kept}${ELLIPSIS}`;
}

/** Bytes a code point adds to the encoded record: JSON escaping can make it longer than its plain UTF-8 form. */
function encodedBytes(codePoint: string): number {
  return utf8.encode(JSON.stringify(codePoint)).length - 2;
}

/**
 * The longest whole-code-point prefix of `text` that, with an ellipsis, encodes to at most `maxBytes` inside the
 * record's JSON; "" when not even the ellipsis fits.
 */
function truncateEncoded(text: string, maxBytes: number): string {
  const budget = maxBytes - encodedBytes(ELLIPSIS);
  if (budget < 0) return "";
  let kept = "";
  let used = 0;
  for (const codePoint of text) {
    const size = encodedBytes(codePoint);
    if (used + size > budget) break;
    kept += codePoint;
    used += size;
  }
  return `${kept}${ELLIPSIS}`;
}

/**
 * Encodes a record, shortening only the rationale until it fits one HCS chunk. Market data, the action and the
 * rejection are evidence and are never trimmed; if they alone exceed the limit this still throws.
 */
export function encodeDecisionFitting(input: DecisionRecord): EncodedDecision {
  let rationale = clampRationale(input.rationale);
  for (;;) {
    try {
      return encodeDecision({ ...input, rationale });
    } catch (error) {
      if (!(error instanceof DecisionTooLargeError) || rationale === "") throw error;
      const overflow = error.size - MAX_DECISION_BYTES;
      const current = [...rationale].reduce((total, codePoint) => total + encodedBytes(codePoint), 0);
      // The target is strictly below the current size, so every round shortens the rationale and the loop ends at
      // the latest when it is empty.
      const shorter = truncateEncoded(rationale, current - overflow);
      rationale = shorter.length < rationale.length ? shorter : "";
    }
  }
}
