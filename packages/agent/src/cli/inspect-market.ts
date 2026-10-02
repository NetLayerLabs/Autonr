import { parseArgs } from "node:util";
import { formatUnits } from "viem";
import { line } from "../agent/log";
import { loadReadOnlyConfig, type ReadOnlyConfig, scriptCommand } from "../config";
import { hashscanUrl } from "../hedera";
import { type TokenRef } from "../networks";
import { formatUsdPrice } from "../oracles/math";
import { fetchMarketSnapshot, type MarketSnapshot, type OracleSnapshot } from "../oracles/snapshot";
import {
  DEFAULT_MAX_SLIPPAGE_BPS,
  formatBps,
  formatFee,
  inspectPool,
  missingPoolDetail,
  type PoolInspection,
  type TradeProbe,
} from "../saucerswap";
import { cliArgs, EXIT, runCli } from "./_shared";

const USAGE = `Usage: ${scriptCommand("market:inspect", "[--json]")}

Compares the configured SaucerSwap V2 pool with the oracles and shows whether the vault would
accept a $1 buy and a $1 sell right now. Needs no vault: without one it assumes
${DEFAULT_MAX_SLIPPAGE_BPS} bps of slippage. Reads nothing secret and sends nothing.

  --json       print the report as JSON
  -h, --help   show this help`;

await runCli(USAGE, async () => {
  const { values } = parseArgs({
    args: cliArgs(),
    options: {
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return EXIT.ok;
  }

  const cfg = loadReadOnlyConfig();
  const snapshot = await fetchMarketSnapshot(cfg);
  const inspection = await inspectPool(cfg, snapshot);

  if (values.json) {
    const report = {
      network: cfg.network,
      pair: `${cfg.baseToken.symbol}/${cfg.quoteToken.symbol}`,
      poolFee: cfg.poolFee,
      vault: cfg.vaultAddress,
      oracles: snapshot,
      inspection,
      ...(inspection ? {} : { detail: missingPoolDetail(cfg) }),
    };
    console.log(
      JSON.stringify(report, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2),
    );
    return EXIT.ok;
  }
  printReport(cfg, snapshot, inspection);
  return EXIT.ok;
});

function printReport(cfg: ReadOnlyConfig, snapshot: MarketSnapshot, inspection: PoolInspection | null): void {
  const { baseToken: base, quoteToken: quote } = cfg;
  console.log(`SaucerSwap V2 ${base.symbol}/${quote.symbol}, ${formatFee(cfg.poolFee)} fee tier, ${cfg.network}`);
  console.log(line("oracle", describeOracle(snapshot.base)));
  console.log(line("", describeOracle(snapshot.quote)));
  if (!inspection) {
    console.log(missingPoolDetail(cfg));
    return;
  }
  const { state } = inspection;
  console.log(line("pool", `${state.pool} ${hashscanUrl(cfg.network, "contract", state.pool)}`));
  console.log(line("liquidity", `${state.liquidity} (active at the current price)`));
  const poolPrice = `${base.symbol} ${formatUsdPrice(inspection.poolPriceUsd)} in the pool`;
  console.log(line("price", `${poolPrice}, ${formatBps(inspection.deviationBps)} vs the oracle`));
  const policy = cfg.vaultAddress ? `the policy of vault ${cfg.vaultAddress}` : "no vault configured";
  console.log(line("slippage", `${inspection.maxSlippageBps} bps (${policy})`));
  console.log(line("$1 buy", describeProbe(inspection.buy, quote, base)));
  console.log(line("$1 sell", describeProbe(inspection.sell, base, quote)));
  if (inspection.buy.quoteSource === "spot" || inspection.sell.quoteSource === "spot") {
    console.log(
      line("note", "SaucerSwap's quoter did not answer, so outputs are spot-price estimates (no price impact)"),
    );
  }
}

function describeOracle(oracle: OracleSnapshot): string {
  const source = `${oracle.source === "chainlink" ? "Chainlink" : "Supra"} ${oracle.feed}`;
  const crossCheck = oracle.crossCheck ? `, Supra ${oracle.crossCheck.divergenceBps} bps apart` : "";
  return `${oracle.symbol} ${formatUsdPrice(oracle.priceUsd)} (${source}, ${oracle.ageSeconds} s old${crossCheck})`;
}

function describeProbe(probe: TradeProbe, tokenIn: TokenRef, tokenOut: TokenRef): string {
  const amount = (raw: bigint, token: TokenRef) => `${formatUnits(raw, token.decimals)} ${token.symbol}`;
  return (
    `the vault would ${probe.accepted ? "accept" : "refuse"}: ${amount(probe.amountIn, tokenIn)} in, ` +
    `${amount(probe.amountOut, tokenOut)} out, vault minimum ${amount(probe.minAmountOut, tokenOut)}`
  );
}
