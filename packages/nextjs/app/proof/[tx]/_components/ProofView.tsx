"use client";

import { CheckList } from "./CheckList";
import { DecisionTimeline } from "./DecisionTimeline";
import { PriceComparison } from "./PriceComparison";
import { SaidVsDid } from "./SaidVsDid";
import { TamperLab } from "./TamperLab";
import { TradeXray } from "./TradeXray";
import { VerdictBanner } from "./VerdictBanner";
import { type NetworkName, getNetwork } from "@sh/agent/networks";
import { CommandLine } from "~~/components/autonr/CommandLine";
import { ExternalLink } from "~~/components/autonr/ExternalLink";
import { Panel } from "~~/components/autonr/Panel";
import { QueryBoundary } from "~~/components/autonr/QueryBoundary";
import { useProof } from "~~/hooks/autonr/useAutonrApi";
import type { TokenInfo } from "~~/hooks/autonr/useTokenDirectory";
import type { TradeEvidence, TradeProof } from "~~/lib/api/types";
import { verifyCommand } from "~~/lib/commands";
import { e18ToNumber, formatTokenAmount, formatUsd } from "~~/lib/format";

export const ProofView = ({ tx, network }: { tx: string; network: string | null }) => {
  const query = useProof(tx, network);
  return (
    <QueryBoundary query={query} skeletonLines={10}>
      {({ proof, evidence }) => <ProofReport proof={proof} evidence={evidence} />}
    </QueryBoundary>
  );
};

/** The proof page reads token metadata from the trade's own network, which may differ from the dashboard's. */
function tokensOf(network: NetworkName): (address: string) => TokenInfo | null {
  const { baseToken, quoteToken } = getNetwork(network);
  return address =>
    [baseToken, quoteToken].find(token => token.address.toLowerCase() === address.toLowerCase()) ?? null;
}

const ProofReport = ({ proof, evidence }: { proof: TradeProof; evidence: TradeEvidence }) => {
  const token = tokensOf(proof.network);
  const sold = token(proof.tokenIn);
  const bought = token(proof.tokenOut);
  const amount = (raw: string, info: TokenInfo | null) =>
    info ? `${formatTokenAmount(raw, info.decimals)} ${info.symbol}` : `${raw} units`;
  const summary = `Sold ${amount(proof.receipt.amountIn, sold)} for ${amount(proof.receipt.amountOut, bought)}, worth ${formatUsd(
    e18ToNumber(proof.receipt.usdValue),
  )}`;

  return (
    <div className="flex flex-col gap-4">
      <VerdictBanner proof={proof} summary={summary} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title="Checks"
          description="Each check uses public data only: Mirror Node REST plus contract state re-read at the trade's block."
        >
          <CheckList checks={proof.checks} />
        </Panel>
        <div className="flex flex-col gap-4">
          <DecisionTimeline proof={proof} />
          <PriceComparison proof={proof} token={token} />
          <VerifyYourself proof={proof} />
        </div>
      </div>
      <TradeXray evidence={evidence} />
      <SaidVsDid proof={proof} token={token} />
      <TamperLab evidence={evidence} />
    </div>
  );
};

const VerifyYourself = ({ proof }: { proof: TradeProof }) => {
  const mirror = getNetwork(proof.network).mirrorUrl;
  const sources = [
    { label: "Contract result and logs", url: `${mirror}/api/v1/contracts/results/${proof.txHash}` },
    { label: "Call trace", url: `${mirror}/api/v1/contracts/results/${proof.txHash}/actions` },
    { label: "Decision message", url: `${mirror}/api/v1/topics/${proof.topicId}/messages/${proof.sequence}` },
  ];
  return (
    <Panel title="Verify it yourself" description="Same verifier, from a terminal, or read the raw Mirror Node data.">
      <div className="flex flex-col gap-3">
        <CommandLine command={verifyCommand(proof.txHash, proof.network)} />
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
          {sources.map(source => (
            <li key={source.url}>
              <ExternalLink href={source.url}>{source.label}</ExternalLink>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
};
