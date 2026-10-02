import { fail, readJsonObject, respond } from "~~/lib/server/http";
import {
  TICK_REQUEST_SHAPE,
  isJsonRequest,
  isTickRunning,
  parseTickRequest,
  runAgentTick,
  tickApiRejection,
} from "~~/lib/server/tick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rejection = tickApiRejection(request);
  if (rejection) return fail(403, rejection);
  if (!isJsonRequest(request)) return fail(415, 'Send the body with the header "content-type: application/json".');
  const body = await readJsonObject(request);
  const tickRequest = body && parseTickRequest(body);
  if (!tickRequest) return fail(400, TICK_REQUEST_SHAPE);
  if (isTickRunning()) return fail(409, "A tick is already running in this server. Wait for it to finish.");
  return respond("agent/tick", () => runAgentTick(tickRequest));
}
