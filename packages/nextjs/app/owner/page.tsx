import { OwnerConsole } from "./_components/OwnerConsole";
import { PageTitle } from "~~/components/autonr/PageTitle";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Owner console",
  description: "Pause the AgentVault, set its risk policy, configure tokens, change the agent and withdraw.",
});

export default function OwnerPage() {
  return (
    <div className="page">
      <PageTitle title="Owner console">
        <p className="m-0">
          The owner sets the limits the agent trades within. Every control here is a transaction from the owner wallet
          to the vault; the agent key cannot call any of them.
        </p>
      </PageTitle>
      <OwnerConsole />
    </div>
  );
}
