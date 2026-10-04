import { ProofView } from "./_components/ProofView";
import { PageTitle } from "~~/components/autonr/PageTitle";
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
    <div className="page">
      <PageTitle title="Trade proof">
        <p className="m-0">
          An independent re-check of one trade from public Hedera Mirror Node data: the decision the agent published,
          the prices the vault saw and the swap it made.
        </p>
      </PageTitle>
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
