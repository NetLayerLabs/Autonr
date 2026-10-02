import { NextResponse } from "next/server";
import { describeError } from "@sh/agent";
import { VerifyError, type VerifyErrorCode } from "@sh/agent/verify";
import "server-only";
import type { ApiErrorBody } from "~~/lib/api/types";

/**
 * Values that must never reach a response body. RPC and Mirror Node URLs are included because commercial providers
 * embed API keys in them.
 */
const SECRET_ENV_VARS = [
  "AGENT_PRIVATE_KEY",
  "OPERATOR_PRIVATE_KEY",
  "ANTHROPIC_API_KEY",
  "AUTONR_TICK_API_SECRET",
  "HEDERA_RPC_URL",
  "HEDERA_MIRROR_URL",
] as const;

const MAX_REASON_LENGTH = 300;

/** The verifier's own refusals are the caller's problem (4xx), not an upstream failure. */
const VERIFY_ERROR_STATUS: Record<VerifyErrorCode, 400 | 404 | 422> = {
  "invalid-input": 400,
  "not-found": 404,
  "not-a-trade": 422,
  "not-replayable": 422,
};

/** A failed call to a Hedera service (JSON-RPC relay or Mirror Node), with what the route was trying to do. */
export class UpstreamError extends Error {
  constructor(context: string, cause: unknown) {
    super(context, { cause });
    this.name = "UpstreamError";
  }
}

export async function callUpstream<T>(context: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new UpstreamError(context, error);
  }
}

export function fail(status: 400 | 403 | 404 | 409 | 415 | 422, message: string): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Runs a route's loader and answers 200 with its result, 4xx when the verifier rejects the request, or 502 when a
 * Hedera service failed. The operator gets the full error in the server log; the client gets one redacted line, never
 * a stack trace.
 */
export async function respond<T>(route: string, load: () => Promise<T> | T): Promise<NextResponse<T | ApiErrorBody>> {
  try {
    return NextResponse.json(await load());
  } catch (error) {
    if (!(error instanceof UpstreamError)) throw error;
    const { cause } = error;
    if (cause instanceof VerifyError) return fail(VERIFY_ERROR_STATUS[cause.code], redact(cause.message));
    console.error(`[api/${route}] ${error.message}`, cause);
    return NextResponse.json({ error: `${error.message}: ${publicReason(cause)}` }, { status: 502 });
  }
}

/** Parses an optional `limit` query parameter; null means it was present but invalid. */
export function parseLimit(request: Request, fallback: number, max: number): number | null {
  const raw = new URL(request.url).searchParams.get("limit");
  if (raw === null) return fallback;
  const limit = Number(raw);
  return Number.isInteger(limit) && limit >= 1 && limit <= max ? limit : null;
}

/** Reads a JSON object body; an empty body counts as `{}`. Returns null when the body is not a JSON object. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function publicReason(error: unknown): string {
  return redact(describeError(error)).slice(0, MAX_REASON_LENGTH);
}

function redact(text: string): string {
  let redacted = text;
  for (const name of SECRET_ENV_VARS) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    for (const form of new Set([value, value.replace(/^0x/i, "")])) {
      if (form.length >= 8) redacted = redacted.split(form).join(`[${name}]`);
    }
  }
  return redacted;
}
