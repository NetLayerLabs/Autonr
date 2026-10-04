import React from "react";
import Image from "next/image";
import { HederaPortalFaucet } from "@scaffold-hbar-ui/components";
import { hedera } from "viem/chains";
import { useMarket } from "~~/hooks/autonr/useAutonrApi";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";

const FOOTER_LINKS = [
  { label: "GitHub", href: "https://github.com/NetLayerLabs/Autonr" },
  { label: "Hedera docs", href: "https://docs.hedera.com/" },
];

/**
 * Site footer
 */
export const Footer = () => {
  const { targetNetwork } = useTargetNetwork();
  const isTestnet = targetNetwork.id !== hedera.id;
  // The same oracle price the vault trades at, rather than a third-party market quote.
  const base = useMarket().data?.snapshot.base;

  return (
    // In the page flow rather than fixed to the viewport: the dashboard's tables run the full height of the page.
    <footer className="mx-auto mt-8 w-full max-w-7xl px-4 pb-10 sm:px-6">
      <div className="surface-rule flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t pt-7">
        <div className="flex min-w-0 items-center gap-3">
          <Image alt="" src="/autonr-mark.svg" width={21} height={20} className="h-5 w-auto" />
          <p className="tagline">Autonomy, enforced.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {base && (
            <span
              className="liquid-glass inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[12.5px]"
              title={`${base.symbol} from ${base.feed} (${base.source})`}
            >
              <span className="text-[#7a7a7a]">{base.symbol}</span>
              <span className="font-mono text-white">${base.priceUsd.toFixed(4)}</span>
            </span>
          )}
          {isTestnet && <HederaPortalFaucet showIcon />}
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[#a6a6a6]">
          {FOOTER_LINKS.map(({ label, href }) => (
            <a key={href} href={href} target="_blank" rel="noreferrer" className="transition-colors hover:text-white">
              {label}
            </a>
          ))}
          <span className="text-[#7a7a7a]">
            Built on{" "}
            <a
              href="https://hedera.com/"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-white"
            >
              Hedera
            </a>
          </span>
        </nav>
      </div>
    </footer>
  );
};
