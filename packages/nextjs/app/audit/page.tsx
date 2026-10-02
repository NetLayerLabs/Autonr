import { AuditReportPanel } from "./_components/AuditReportPanel";
import { RejectionsPanel } from "./_components/RejectionsPanel";
import { CommandLine } from "~~/components/autonr/CommandLine";
import { Panel } from "~~/components/autonr/Panel";
import { COMMANDS } from "~~/lib/commands";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Audit",
  description: "Check that every Autonr trade maps to a decision published on HCS, and replay the vault's refusals.",
});

export default function AuditPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="m-0 text-2xl font-bold">Audit</h1>
        <p className="m-0 mt-1 max-w-3xl text-sm text-base-content/80">
          The decision topic and the vault&apos;s trade events are both public. This page cross-checks them from the
          Mirror Node: nothing here depends on trusting this dashboard or the agent.
        </p>
      </div>
      <AuditReportPanel />
      <RejectionsPanel />
      <Panel title="Run the same audit yourself" description="The CLI uses the same verifier as this page.">
        <div className="max-w-xl">
          <CommandLine command={COMMANDS.audit} />
        </div>
      </Panel>
    </div>
  );
}
