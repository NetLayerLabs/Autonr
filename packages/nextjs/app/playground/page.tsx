import { GuardrailPlayground } from "./_components/GuardrailPlayground";
import { PageTitle } from "~~/components/autonr/PageTitle";
import { RED_TEAM_SCENARIOS } from "~~/lib/server/red-team";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Guardrail playground",
  description: "Ask the live AgentVault to break its own rules and watch it refuse.",
});

export default function PlaygroundPage() {
  return (
    <div className="page">
      <PageTitle title="Guardrail playground">
        <p className="m-0">
          Each card asks the deployed vault to do one thing its policy forbids, as an eth_call from the agent&apos;s
          address. Nothing is signed or sent and no HBAR is spent; the vault answers with the custom error it would
          revert with, decoded from its ABI.
        </p>
      </PageTitle>
      <GuardrailPlayground scenarios={RED_TEAM_SCENARIOS} />
    </div>
  );
}
