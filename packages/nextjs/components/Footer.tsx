import React from "react";
import { HederaPortalFaucet } from "@scaffold-hbar-ui/components";
import { hedera } from "viem/chains";
import { CurrencyDollarIcon } from "@heroicons/react/24/outline";
import { SwitchTheme } from "~~/components/SwitchTheme";
import { useMarket } from "~~/hooks/autonr/useAutonrApi";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";

/**
 * Site footer
 */
export const Footer = () => {
  const { targetNetwork } = useTargetNetwork();
  const isTestnet = targetNetwork.id !== hedera.id;
  // The same oracle price the vault trades at, rather than a third-party market quote.
  const base = useMarket().data?.snapshot.base;

  return (
    <div className="min-h-0 py-5 px-4">
      {/* In the page flow rather than fixed to the viewport: the dashboard's tables run the full height of the page. */}
      <div>
        <div className="flex flex-wrap justify-between items-center gap-2 w-full pb-2">
          <div className="flex flex-col md:flex-row gap-2">
            {base && (
              <div>
                <span
                  className="btn btn-primary btn-sm font-normal gap-1 cursor-auto"
                  title={`${base.symbol} from ${base.feed} (${base.source})`}
                >
                  <CurrencyDollarIcon className="h-4 w-4" />
                  <span>{base.priceUsd.toFixed(4)}</span>
                </span>
              </div>
            )}
            {isTestnet && <HederaPortalFaucet showIcon />}
          </div>
          <SwitchTheme />
        </div>
      </div>
      <div className="w-full">
        <nav className="menu menu-horizontal w-full">
          <div className="flex justify-center items-center gap-3 text-sm w-full text-base-content/60">
            <a
              href="https://github.com/NetLayerLabs/Autonr"
              target="_blank"
              rel="noreferrer"
              className="link hover:text-primary"
            >
              GitHub
            </a>
            <span className="opacity-30">|</span>
            <span>
              Built on{" "}
              <a
                href="https://hedera.com/"
                target="_blank"
                rel="noreferrer"
                className="font-semibold link hover:text-primary"
              >
                Hedera
              </a>
            </span>
            <span className="opacity-30">|</span>
            <a href="https://docs.hedera.com/" target="_blank" rel="noreferrer" className="link hover:text-primary">
              Docs
            </a>
          </div>
        </nav>
      </div>
    </div>
  );
};
