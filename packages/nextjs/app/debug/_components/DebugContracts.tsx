"use client";

import { useEffect, useMemo } from "react";
import { ContractUI } from "./ContractUI";
import "@scaffold-hbar-ui/debug-contracts/styles.css";
import { useSessionStorage } from "usehooks-ts";
import { BarsArrowUpIcon } from "@heroicons/react/20/solid";
import { EmptyState } from "~~/components/autonr/EmptyState";
import { COMMANDS } from "~~/lib/commands";
import { ContractName, GenericContract } from "~~/utils/scaffold-hbar/contract";
import { useAllContracts } from "~~/utils/scaffold-hbar/contractsData";

const selectedContractStorageKey = "scaffoldEth2.selectedContract";

export function DebugContracts() {
  const contractsData = useAllContracts();
  const contractNames = useMemo(
    () =>
      Object.keys(contractsData).sort((a, b) => {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      }) as ContractName[],
    [contractsData],
  );

  const [selectedContract, setSelectedContract] = useSessionStorage<ContractName>(
    selectedContractStorageKey,
    contractNames[0],
    { initializeWithValue: false },
  );

  useEffect(() => {
    if (!contractNames.includes(selectedContract)) {
      setSelectedContract(contractNames[0]);
    }
  }, [contractNames, selectedContract, setSelectedContract]);

  return (
    <div className="flex flex-col gap-y-6 lg:gap-y-8 justify-center items-center">
      {contractNames.length === 0 ? (
        <div className="mt-14 w-full max-w-xl px-6">
          <EmptyState
            reason="No contracts are deployed on this network yet. Deploying writes each contract's address and ABI here."
            commands={[COMMANDS.deploy]}
          />
        </div>
      ) : (
        <>
          {contractNames.length > 1 && (
            <div className="flex flex-row gap-2 w-full pb-1 flex-wrap">
              {contractNames.map(contractName => (
                <button
                  className={`btn btn-sm ${
                    contractName === selectedContract ? "bg-white/10 text-white" : "text-[#a6a6a6] hover:text-white"
                  }`}
                  key={String(contractName)}
                  onClick={() => setSelectedContract(contractName)}
                >
                  {String(contractName)}
                  {(contractsData[String(contractName)] as GenericContract)?.external && (
                    <span className="tooltip tooltip-top" data-tip="External contract">
                      <BarsArrowUpIcon className="h-4 w-4 cursor-pointer" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {contractNames.map(
            contractName =>
              contractName === selectedContract && (
                <ContractUI key={String(contractName)} contractName={contractName} />
              ),
          )}
        </>
      )}
    </div>
  );
}
