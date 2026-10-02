import { formatUnits } from "viem";
import { Panel } from "~~/components/autonr/Panel";
import type { TokenInfo } from "~~/hooks/autonr/useTokenDirectory";
import type { TradeProof } from "~~/lib/api/types";
import { e18ToNumber, formatRate, formatTokenAmount } from "~~/lib/format";

type PriceComparisonProps = { proof: TradeProof; token: (address: string) => TokenInfo | null };

/**
 * Where the swap landed relative to the vault's own numbers. The oracle-fair output is recomputed exactly as the
 * vault does it, mulDiv(usdValue, 10^decimalsOut, priceOutE18), from the receipt alone.
 */
export const PriceComparison = ({ proof, token }: PriceComparisonProps) => {
  const tokenIn = token(proof.tokenIn);
  const tokenOut = token(proof.tokenOut);
  const { receipt } = proof;

  if (!tokenIn || !tokenOut || receipt.oracleOut.priceE18 === "0") {
    return (
      <Panel title="Oracle price vs execution">
        <p className="m-0 text-sm">The token pair is not one this dashboard knows the decimals of.</p>
      </Panel>
    );
  }

  const fair = (BigInt(receipt.usdValue) * 10n ** BigInt(tokenOut.decimals)) / BigInt(receipt.oracleOut.priceE18);
  const minimum = BigInt(receipt.minAmountOut);
  const actual = BigInt(receipt.amountOut);
  const vsFairBps = fair > 0n ? Number(((actual - fair) * 10_000n) / fair) : 0;
  const oracleRate = e18ToNumber(receipt.oracleIn.priceE18) / e18ToNumber(receipt.oracleOut.priceE18);
  const executionRate =
    Number(formatUnits(actual, tokenOut.decimals)) / Number(formatUnits(BigInt(receipt.amountIn), tokenIn.decimals));
  const amount = (value: bigint) => `${formatTokenAmount(value, tokenOut.decimals)} ${tokenOut.symbol}`;

  const points = [
    { key: "minimum", label: "Vault minimum", value: minimum, mark: "min" as const },
    { key: "fair", label: "Oracle-fair", value: fair, mark: "fair" as const },
    { key: "actual", label: "Received", value: actual, mark: "actual" as const },
  ];

  return (
    <Panel
      title="Oracle price vs execution"
      description={`In ${tokenOut.symbol} for ${formatTokenAmount(receipt.amountIn, tokenIn.decimals)} ${tokenIn.symbol} sold.`}
    >
      <div className="flex flex-col gap-3">
        <DotPlot points={points} />
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          {points.map(point => (
            <div key={point.key} className="contents">
              <dt className="flex items-center gap-2 text-base-content/70">
                <MarkerGlyph mark={point.mark} />
                {point.label}
              </dt>
              <dd className="m-0 text-right font-mono tabular-nums">{amount(point.value)}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0 text-sm">
          Received{" "}
          <span className="font-semibold tabular-nums">
            {vsFairBps >= 0 ? "+" : ""}
            {(vsFairBps / 100).toFixed(2)}%
          </span>{" "}
          versus the oracle-fair amount: 1 {tokenIn.symbol} traded at {formatRate(executionRate)} {tokenOut.symbol}, the
          oracles priced it at {formatRate(oracleRate)}.
        </p>
      </div>
    </Panel>
  );
};

type Mark = "min" | "fair" | "actual";

const MarkerGlyph = ({ mark }: { mark: Mark }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
    {mark === "min" && <rect x="5" y="0" width="2" height="12" className="fill-base-content" />}
    {mark === "fair" && <circle cx="6" cy="6" r="4.5" strokeWidth="2" className="fill-base-100 stroke-base-content" />}
    {mark === "actual" && <circle cx="6" cy="6" r="5" className="fill-primary" />}
  </svg>
);

/** The three amounts on one axis; values are listed below the plot, so no label sits on the marks. */
const DotPlot = ({ points }: { points: { key: string; label: string; value: bigint; mark: Mark }[] }) => {
  const values = points.map(point => Number(point.value));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * 0.08 || Math.max(high * 0.01, 1);
  const position = (value: number) => ((value - (low - pad)) / (high - low + 2 * pad)) * 100;

  return (
    <svg
      role="img"
      aria-label={points.map(point => `${point.label} ${point.value}`).join(", ")}
      width="100%"
      height="28"
      className="block overflow-visible"
    >
      <line x1="0" x2="100%" y1="14" y2="14" strokeWidth="1" className="stroke-base-300" />
      {points.map(point => {
        const x = `${position(Number(point.value))}%`;
        if (point.mark === "min") {
          return <line key={point.key} x1={x} x2={x} y1="4" y2="24" strokeWidth="2" className="stroke-base-content" />;
        }
        if (point.mark === "fair") {
          return (
            <circle
              key={point.key}
              cx={x}
              cy="14"
              r="6"
              strokeWidth="2"
              className="fill-base-100 stroke-base-content"
            />
          );
        }
        return <circle key={point.key} cx={x} cy="14" r="6" strokeWidth="2" className="fill-primary stroke-base-100" />;
      })}
    </svg>
  );
};
