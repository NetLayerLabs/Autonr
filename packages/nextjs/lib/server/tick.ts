import { SetupMismatchError, runTick } from "@sh/agent";
import { createHash, timingSafeEqual } from "node:crypto";
import "server-only";
import type { TickRequest, TickResponse } from "~~/lib/api/types";
import { getAgentConfig, getReadOnlyConfig } from "~~/lib/server/config";
import { UpstreamError } from "~~/lib/server/http";
import { agentMismatch, agentNotConfigured } from "~~/lib/server/not-configured";

export const TICK_REQUEST_SHAPE =
  'Expected a JSON body { "dryRun"?: boolean, "manual"?: { "side": "buy" | "sell", "usd": number > 0 } }.';

let tickInFlight = false;

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", "[::1]"]);

/**
 * Why the request may not trigger a tick, or null when it may. A tick spends the agent's HBAR (HCS fees, gas) and can
 * trade, so the route is off unless the operator enables it, and a configured secret is compared in constant time.
 * Without a secret only the local development server answers, and only requests made to and from localhost.
 */
export function tickApiRejection(request: Request): string | null {
  if (!getReadOnlyConfig().tickApiEnabled) {
    return "The tick API is disabled. Set AUTONR_ENABLE_TICK_API=true in packages/agent/.env and restart the dashboard.";
  }
  const secret = process.env.AUTONR_TICK_API_SECRET;
  if (!secret) {
    if (isLocalDevelopmentRequest(request)) return null;
    return "No AUTONR_TICK_API_SECRET is set, so the tick API only answers localhost under `yarn start` (next dev). Set the secret in packages/agent/.env to run ticks from anywhere else.";
  }
  if (!sameSecret(request.headers.get("x-autonr-secret") ?? "", secret)) {
    return "Missing or wrong x-autonr-secret header: it must equal AUTONR_TICK_API_SECRET.";
  }
  return null;
}

/**
 * Route handlers cannot see the socket, so this relies on the headers Next.js fills in: it sets x-forwarded-for to the
 * peer address when the client sent none. A client that reaches the server directly can forge both headers, which is
 * why this is limited to `next dev`; a production server always needs the secret. Checking Host as well refuses DNS
 * rebinding, where a web page reaches localhost under its own host name.
 */
function isLocalDevelopmentRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const forwardedFor = request.headers.get("x-forwarded-for");
  const peers = forwardedFor?.split(",").map(peer => peer.trim()) ?? [];
  if (peers.length === 0 || !peers.every(peer => LOOPBACK_ADDRESSES.has(peer))) return false;
  return LOOPBACK_ADDRESSES.has(hostName(request.headers.get("host")));
}

function hostName(host: string | null): string {
  if (!host) return "";
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

/**
 * A cross-site HTML form can post a text/plain body that happens to be valid JSON without any CORS preflight. Requiring
 * application/json forces the preflight, which other origins cannot pass, so another website cannot trigger a tick.
 */
export function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

export function parseTickRequest(body: Record<string, unknown>): TickRequest | null {
  const { dryRun, manual } = body;
  if (dryRun !== undefined && typeof dryRun !== "boolean") return null;
  if (manual === undefined) return { dryRun };
  if (typeof manual !== "object" || manual === null) return null;
  const { side, usd } = manual as Record<string, unknown>;
  if (side !== "buy" && side !== "sell") return null;
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return null;
  return { dryRun, manual: { side, usd } };
}

/** Two overlapping ticks would race for the same reasoning sequence; the vault would refuse one after it paid fees. */
export function isTickRunning(): boolean {
  return tickInFlight;
}

export async function runAgentTick(request: TickRequest): Promise<TickResponse> {
  const agent = getAgentConfig();
  if (!agent.ok) return agentNotConfigured(agent.missing);
  tickInFlight = true;
  try {
    return { configured: true, result: await runTick(agent.config, request) };
  } catch (error) {
    // The env and the vault disagree on the agent or the topic: a setup problem for the operator, not an outage.
    if (error instanceof SetupMismatchError) return agentMismatch(error.message);
    throw new UpstreamError("The agent tick failed", error);
  } finally {
    tickInFlight = false;
  }
}

// Hashing both values first yields equal-length buffers, so the comparison time does not depend on the secret.
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
