import { AgentPanel } from "./_components/AgentPanel";
import { DecisionLog } from "./_components/DecisionLog";
import { MissionHero } from "./_components/MissionHero";
import { OracleConsensusPanel } from "./_components/OracleConsensusPanel";
import { TradesTable } from "./_components/TradesTable";
import { VaultPanel } from "./_components/VaultPanel";

export default function MissionControl() {
  return (
    <>
      <MissionHero aside={<AgentPanel />} />
      <div className="mx-auto -mt-8 flex w-full max-w-7xl flex-col gap-4 px-4 pb-12 sm:px-6">
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <OracleConsensusPanel />
          <VaultPanel />
        </div>
        <DecisionLog />
        <TradesTable />
      </div>
    </>
  );
}
