import { getReplay } from "~~/lib/server/history";
import { fail, respond } from "~~/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ sequence: string }> }) {
  const { sequence } = await params;
  const value = Number(sequence);
  if (!/^[1-9]\d*$/.test(sequence) || !Number.isSafeInteger(value)) {
    return fail(400, "sequence must be a positive integer: the HCS sequence number of a rejected decision.");
  }
  return respond("replay", () => getReplay(value));
}
