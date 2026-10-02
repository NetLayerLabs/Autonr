import { OwnerConsole } from "./_components/OwnerConsole";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Owner console",
  description: "Pause the AgentVault, set its risk policy, configure tokens, change the agent and withdraw.",
});

export default function OwnerPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="m-0 text-2xl font-bold">Owner console</h1>
        <p className="m-0 mt-1 max-w-3xl text-sm text-base-content/80">
          The owner sets the limits the agent trades within. Every control here is a transaction from the owner wallet
          to the vault; the agent key cannot call any of them.
        </p>
      </div>
      <OwnerConsole />
    </div>
  );
}
