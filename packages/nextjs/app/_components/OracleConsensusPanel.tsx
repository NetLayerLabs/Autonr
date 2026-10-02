"use client";

import { hashscanUrl } from "@sh/agent/hedera";
import type { NetworkName, TokenRef } from "@sh/agent/networks";
import { ExternalLink } from "~~/components/autonr/ExternalLink";
import { Meter } from "~~/components/autonr/Meter";
import { Panel } from "~~/components/autonr/Panel";
import { QueryBoundary } from "~~/components/autonr/QueryBoundary";
import { RelativeTime } from "~~/components/autonr/RelativeTime";
import { useMarket, useVault } from "~~/hooks/autonr/useAutonrApi";
import { useNow } from "~~/hooks/autonr/useNow";
import type { OracleSnapshot, VaultPolicy } from "~~/lib/api/types";
import { formatBps, formatDuration, formatPrice } from "~~/lib/format";

/** Chainlink and Supra side by side, measured against the vault's own staleness and divergence limits. */
export const OracleConsensusPanel = () => {
  const market = useMarket();
  const vault = useVault();
  const policy = vault.data?.configured ? vault.data.vault.policy : null;

  return (
    <Panel
      title="Oracle consensus"
      description="Read straight from the oracle contracts. Chainlink prices WHBAR and Supra must agree; Supra alone prices the stablecoin."
    >
      <QueryBoundary query={market} skeletonLines={6}>
        {({ network, snapshot, base, quote, supra }) => (
          <div className="flex flex-col gap-5">
            <OracleBlock oracle={snapshot.base} token={base} supra={supra} policy={policy} network={network} />
            <OracleBlock oracle={snapshot.quote} token={quote} supra={supra} policy={policy} network={network} />
            {!policy && (
              <p className="m-0 text-xs text-base-content/70">
                Staleness and divergence limits come from the vault policy and appear once a vault is configured.
              </p>
            )}
          </div>
        )}
      </QueryBoundary>
    </Panel>
  );
};

type OracleBlockProps = {
  oracle: OracleSnapshot;
  token: TokenRef;
  supra: string;
  policy: VaultPolicy | null;
  network: NetworkName;
};

const OracleBlock = ({ oracle, token, supra, policy, network }: OracleBlockProps) => {
  const chainlinkHref = token.chainlinkFeed ? hashscanUrl(network, "contract", token.chainlinkFeed) : null;
  const supraHref = hashscanUrl(network, "contract", supra);
  const supraFeed = `${token.supraLabel} (pair ${token.supraPairId})`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">{oracle.symbol}</h3>
        <span className="text-xs text-base-content/70">
          {oracle.crossCheck ? "Chainlink price, Supra cross-check" : "Supra price"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="table table-xs">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col" className="text-right">
                Price
              </th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            <FeedRow
              source={oracle.source === "chainlink" ? "Chainlink" : "Supra"}
              feed={oracle.source === "chainlink" ? oracle.feed : supraFeed}
              href={oracle.source === "chainlink" ? chainlinkHref : supraHref}
              priceUsd={oracle.priceUsd}
              updatedAt={oracle.updatedAt}
              maxAge={policy?.maxPriceAge ?? null}
            />
            {oracle.crossCheck && (
              <FeedRow
                source="Supra"
                feed={supraFeed}
                href={supraHref}
                priceUsd={oracle.crossCheck.priceUsd}
                updatedAt={oracle.crossCheck.updatedAt}
                maxAge={policy?.maxPriceAge ?? null}
              />
            )}
          </tbody>
        </table>
      </div>
      {oracle.crossCheck &&
        (policy ? (
          <Meter
            label="Divergence (|Chainlink - Supra| / Chainlink)"
            value={oracle.crossCheck.divergenceBps}
            limit={policy.maxOracleDivergenceBps}
            scaleMax={policy.maxOracleDivergenceBps * 1.5}
            valueText={formatBps(oracle.crossCheck.divergenceBps)}
            limitText={`limit ${formatBps(policy.maxOracleDivergenceBps)}`}
          />
        ) : (
          <p className="m-0 text-xs">
            Divergence <span className="font-semibold tabular-nums">{formatBps(oracle.crossCheck.divergenceBps)}</span>
          </p>
        ))}
    </div>
  );
};

type FeedRowProps = {
  source: string;
  feed: string;
  href: string | null;
  priceUsd: number;
  updatedAt: number;
  maxAge: number | null;
};

const FeedRow = ({ source, feed, href, priceUsd, updatedAt, maxAge }: FeedRowProps) => {
  const now = useNow(5_000);
  const age = now / 1000 - updatedAt;
  // Same rule as the vault: stale once updatedAt + maxPriceAge is behind the current time.
  const stale = maxAge !== null && age > maxAge;
  return (
    <tr>
      <td>
        <span className="block font-medium">{source}</span>
        {href ? <ExternalLink href={href}>{feed}</ExternalLink> : feed}
      </td>
      <td className="text-right font-mono tabular-nums">{formatPrice(priceUsd)}</td>
      <td>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <RelativeTime date={new Date(updatedAt * 1000)} />
          {maxAge !== null && (
            <span
              className={`badge badge-xs whitespace-nowrap ${stale ? "badge-warning" : "badge-ghost"}`}
              title={`The vault refuses prices older than ${formatDuration(maxAge)}`}
            >
              {stale ? "stale" : "fresh"}
            </span>
          )}
        </span>
      </td>
    </tr>
  );
};
