import { GuardrailPlayground } from "./_components/GuardrailPlayground";
import { RED_TEAM_SCENARIOS } from "~~/lib/server/red-team";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Guardrail playground",
  description: "Ask the live AgentVault to break its own rules and watch it refuse.",
});

export default function PlaygroundPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="m-0 text-2xl font-bold">Guardrail playground</h1>
        <p className="m-0 mt-1 max-w-3xl text-sm text-base-content/80">
          Each card asks the deployed vault to do one thing its policy forbids, as an eth_call from the agent&apos;s
          address. Nothing is signed or sent and no HBAR is spent; the vault answers with the custom error it would
          revert with, decoded from its ABI.
        </p>
      </div>
      <GuardrailPlayground scenarios={RED_TEAM_SCENARIOS} />
    </div>
  );
}
