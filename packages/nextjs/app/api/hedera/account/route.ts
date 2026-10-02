import { MirrorClient, getNetwork, orNull } from "@sh/agent";
import { isAddress } from "viem";
import { getReadOnlyConfig } from "~~/lib/server/config";
import { callUpstream, fail, respond } from "~~/lib/server/http";
import { parseNetwork } from "~~/lib/server/proof";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resolves an EVM address to its Hedera account id for the wallet UI; `accountId` is null for an unknown address. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const evm = searchParams.get("evm");
  if (!evm || !isAddress(evm, { strict: false })) return fail(400, "Missing or invalid EVM address in ?evm=.");
  const network = parseNetwork(searchParams.get("network"));
  if (!network) return fail(400, 'network must be "testnet" or "mainnet".');

  // HEDERA_MIRROR_URL configures the dashboard's own network; another network uses its public Mirror Node.
  const cfg = getReadOnlyConfig();
  const mirror = new MirrorClient({
    baseUrl: network === cfg.network ? cfg.mirrorUrl : getNetwork(network).mirrorUrl,
  });
  return respond("hedera/account", async () => {
    const account = await callUpstream(`Could not look up ${evm} on the ${network} Mirror Node`, () =>
      orNull(mirror.account(evm)),
    );
    return { accountId: account?.account ?? null };
  });
}
