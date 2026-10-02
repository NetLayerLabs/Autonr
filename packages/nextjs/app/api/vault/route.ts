import { respond } from "~~/lib/server/http";
import { getVault } from "~~/lib/server/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return respond("vault", getVault);
}
