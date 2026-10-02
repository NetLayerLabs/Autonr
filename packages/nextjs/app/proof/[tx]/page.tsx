import { ProofView } from "./_components/ProofView";
import { Panel } from "~~/components/autonr/Panel";
import { TX_FORMAT_HINT, parseTx } from "~~/lib/server/proof";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Trade proof",
  description: "Independent verification of an Autonr trade from public Hedera Mirror Node data.",
});

type ProofPageProps = {
  params: Promise<{ tx: string }>;
  searchParams: Promise<{ network?: string | string[] }>;
};

export default async function ProofPage({ params, searchParams }: ProofPageProps) {
  const tx = parseTx((await params).tx);
  const { network } = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">
      {tx ? (
        <ProofView tx={tx} network={typeof network === "string" ? network : null} />
      ) : (
        <Panel title="Not a transaction reference">
          <p className="m-0 text-sm">{TX_FORMAT_HINT}</p>
        </Panel>
      )}
    </div>
  );
}
