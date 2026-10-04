import { DebugContracts } from "./_components/DebugContracts";
import type { NextPage } from "next";
import { PageTitle } from "~~/components/autonr/PageTitle";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Debug Contracts",
  description: "Read and call your deployed contracts",
});

const Debug: NextPage = () => {
  return (
    <div className="page">
      <PageTitle title="Debug contracts">
        <p className="m-0">
          You can debug &amp; interact with your deployed contracts here. Check{" "}
          <code className="text-[13px] text-white">packages/nextjs/app/debug/page.tsx</code>.
        </p>
      </PageTitle>
      <DebugContracts />
    </div>
  );
};

export default Debug;
