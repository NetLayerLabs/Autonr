import { fail, respond } from "~~/lib/server/http";
import { TX_FORMAT_HINT, getProof, parseNetwork, parseTx } from "~~/lib/server/proof";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ tx: string }> }) {
  const tx = parseTx((await params).tx);
  if (!tx) return fail(400, TX_FORMAT_HINT);
  const network = parseNetwork(new URL(request.url).searchParams.get("network"));
  if (!network) return fail(400, 'network must be "testnet" or "mainnet".');
  return respond("proof", () => getProof(tx, network));
}
