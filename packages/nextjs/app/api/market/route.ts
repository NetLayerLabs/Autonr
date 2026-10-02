import { respond } from "~~/lib/server/http";
import { getMarket } from "~~/lib/server/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return respond("market", getMarket);
}
