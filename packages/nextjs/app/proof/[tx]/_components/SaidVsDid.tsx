import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/16/solid";
import { Panel } from "~~/components/autonr/Panel";
import type { TokenInfo } from "~~/hooks/autonr/useTokenDirectory";
import type { SerializedOracleReading, TradeProof } from "~~/lib/api/types";
import { e18ToNumber, formatPrice, formatTokenAmount, formatUsd, formatUtc, shortHex } from "~~/lib/format";

type Row = { field: string; said: string | undefined; did: string; display: (value: string) => string };

type SaidVsDidProps = { proof: TradeProof; token: (address: string) => TokenInfo | null };

/** The agent's published decision next to the vault's TradeExecuted receipt, field by field. */
export const SaidVsDid = ({ proof, token }: SaidVsDidProps) => {
  const record = proof.decision;
  const action = record?.action;
  const tokenIn = token(proof.tokenIn);
  const label = (address: string) => token(address)?.symbol ?? shortHex(address);
  const rows: Row[] = [
    { field: "Vault", said: record?.vault, did: proof.vault, display: shortHex },
    { field: "Token in", said: action?.tokenIn, did: proof.tokenIn, display: label },
    { field: "Token out", said: action?.tokenOut, did: proof.tokenOut, display: label },
    {
      field: "Amount in",
      said: action?.amountIn,
      did: proof.receipt.amountIn,
      display: value => (tokenIn ? `${formatTokenAmount(value, tokenIn.decimals, 8)} ${tokenIn.symbol}` : value),
    },
  ];

  return (
    <Panel
      title="What the agent said, what the vault did"
      description="Left: the decision record from HCS. Right: the receipt the vault emitted in TradeExecuted."
    >
      <div className="flex flex-col gap-4">
        {record === null ? (
          <p className="m-0 text-sm">The decision message is missing or is not a valid decision record.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Agent said</th>
                  <th scope="col">Vault did</th>
                  <th scope="col">
                    <span className="sr-only">Match</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const match = row.said !== undefined && row.said.toLowerCase() === row.did.toLowerCase();
                  return (
                    <tr key={row.field}>
                      <th scope="row" className="font-medium">
                        {row.field}
                      </th>
                      <td className="font-mono text-xs" title={row.said}>
                        {row.said === undefined ? "-" : row.display(row.said)}
                      </td>
                      <td className="font-mono text-xs" title={row.did}>
                        {row.display(row.did)}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1 text-xs">
                          {match ? (
                            <CheckCircleIcon className="h-4 w-4 text-success" aria-hidden />
                          ) : (
                            <XCircleIcon className="h-4 w-4 text-error" aria-hidden />
                          )}
                          {match ? "same" : "differs"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {record && (
          <blockquote className="m-0 border-l-4 border-base-300 pl-3 text-sm">
            <p className="m-0">{record.rationale}</p>
            <footer className="mt-1 text-xs text-base-content/70">
              {record.strategy.id} {record.strategy.version}
              {record.strategy.model && ` (${record.strategy.model})`} · decided {record.createdAt}
            </footer>
          </blockquote>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <details className="min-w-0 text-xs">
            <summary className="cursor-pointer font-medium">Decision record (HCS message #{proof.sequence})</summary>
            {proof.decisionJson === null ? (
              <p className="m-0 mt-2">No message content.</p>
            ) : (
              <>
                <pre className="mt-2 max-h-96 overflow-auto rounded-box bg-base-200 p-3">
                  {readable(proof.decisionJson)}
                </pre>
                <p className="m-0 mt-1 text-base-content/70">
                  Indented here for reading. The hash in the receipt covers the exact bytes published to HCS.
                </p>
              </>
            )}
          </details>
          <details className="min-w-0 text-xs">
            <summary className="cursor-pointer font-medium">TradeExecuted receipt</summary>
            <dl className="m-0 mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-box bg-base-200 p-3">
              <ReceiptRow label="amountIn" value={proof.receipt.amountIn} />
              <ReceiptRow label="amountOut" value={proof.receipt.amountOut} />
              <ReceiptRow label="minAmountOut" value={proof.receipt.minAmountOut} />
              <ReceiptRow
                label="usdValue"
                value={`${proof.receipt.usdValue} (${formatUsd(e18ToNumber(proof.receipt.usdValue))})`}
              />
              <ReceiptRow label="oracleIn" value={describeReading(proof.receipt.oracleIn)} />
              <ReceiptRow label="oracleOut" value={describeReading(proof.receipt.oracleOut)} />
              <ReceiptRow label="reasoningHash" value={proof.receipt.reasoningHash} />
              <ReceiptRow label="hcsTopicNum" value={`${proof.receipt.hcsTopicNum} (${proof.topicId})`} />
              <ReceiptRow label="hcsSequence" value={String(proof.receipt.hcsSequence)} />
            </dl>
          </details>
        </div>
      </div>
    </Panel>
  );
};

const ReceiptRow = ({ label, value }: { label: string; value: string }) => (
  <>
    <dt className="font-mono text-base-content/70">{label}</dt>
    <dd className="m-0 break-all font-mono">{value}</dd>
  </>
);

function describeReading(reading: SerializedOracleReading): string {
  const price = `${formatPrice(e18ToNumber(reading.priceE18))} at ${formatUtc(new Date(reading.updatedAt * 1000))}`;
  if (reading.crossCheckE18 === "0") return price;
  return `${price}; Supra ${formatPrice(e18ToNumber(reading.crossCheckE18))}, ${reading.divergenceBps} bps apart`;
}

function readable(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
