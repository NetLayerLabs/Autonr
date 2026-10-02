import { getTrades } from "~~/lib/server/history";
import { fail, parseLimit, respond } from "~~/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const limit = parseLimit(request, 25, 100);
  if (limit === null) return fail(400, "limit must be an integer from 1 to 100.");
  return respond("trades", () => getTrades(limit));
}
