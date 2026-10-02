import { parseArgs } from "node:util";
import { type Address, getAddress, isAddress } from "viem";
import { loadReadOnlyConfig, type ReadOnlyConfig, scriptCommand } from "../config";
import { hashscanTopicMessageUrl, hashscanUrl } from "../hedera";
import { isNetworkName, type NetworkName } from "../networks";
import {
  type AuditReport,
  auditDecisionLog,
  type CheckStatus,
  replayRejection,
  type ReplayResult,
  type TradeProof,
  verifyTrade,
} from "../verify";
import { cliArgs, EXIT, runCli, UsageError } from "./_shared";

const USAGE = `Verify Autonr trades and decisions using public Mirror Node data only.

  ${scriptCommand("verify", "<tx>")}              check one trade (EVM tx hash or Hedera transaction id)
  ${scriptCommand("verify", "--audit")}           audit the decision log against the vault's trades
  ${scriptCommand("verify", "--replay <seq>")}    re-run a refused trade at its historical block

Options
  --network testnet|mainnet   default: HEDERA_NETWORK, then testnet
  --vault <address>           default: AUTONR_VAULT_ADDRESS
  --topic <topic id>          default: AUTONR_TOPIC_ID
  --limit <n>                 messages to audit (default 100)
  --json                      print the result as JSON
  -h, --help                  show this help`;

const STATUS_LABEL: Record<CheckStatus, string> = { pass: "PASS", fail: "FAIL", warn: "WARN", skip: "SKIP" };

await runCli(USAGE, async () => {
  const { values, positionals } = parseArgs({
    args: cliArgs(),
    allowPositionals: true,
    options: {
      audit: { type: "boolean", default: false },
      replay: { type: "string" },
      network: { type: "string" },
      vault: { type: "string" },
      topic: { type: "string" },
      limit: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return EXIT.ok;
  }
  const config = configFor(values.network);
  const { network, mirrorUrl } = config;

  if (values.audit) {
    const vault = values.vault === undefined ? config.vaultAddress : addressFlag(values.vault);
    const topicId = values.topic ?? config.topicId;
    if (!vault || !topicId) {
      const fix = "set AUTONR_VAULT_ADDRESS and AUTONR_TOPIC_ID in packages/agent/.env, or pass --vault and --topic";
      throw new UsageError(`--audit needs a vault and a topic: ${fix}`);
    }
    const limit = values.limit === undefined ? undefined : integerFlag("--limit", values.limit);
    const report = await auditDecisionLog({ network, vault, topicId, limit, mirrorUrl });
    print(values.json, report, printAudit);
    return report.ok ? EXIT.ok : EXIT.failure;
  }
  if (values.replay !== undefined) {
    const topicId = values.topic ?? config.topicId;
    if (!topicId) {
      throw new UsageError("--replay needs a topic: set AUTONR_TOPIC_ID in packages/agent/.env or pass --topic");
    }
    const sequence = integerFlag("--replay", values.replay);
    const result = await replayRejection({ network, topicId, sequence, mirrorUrl });
    print(values.json, result, replay => printReplay(replay, network, topicId));
    return result.reproduced ? EXIT.ok : EXIT.failure;
  }
  const [tx, ...extra] = positionals;
  if (!tx || extra.length > 0) throw new UsageError("pass exactly one transaction, or --audit, or --replay <seq>");
  const proof = await verifyTrade({ network, tx, mirrorUrl });
  print(values.json, proof, printProof);
  return proof.verdict === "failed" ? EXIT.failure : EXIT.ok;
});

/** The env file describes one network's deployment; asking for another network uses that network's defaults. */
function configFor(networkFlag: string | undefined): ReadOnlyConfig {
  const configured = loadReadOnlyConfig();
  if (networkFlag === undefined || networkFlag === configured.network) return configured;
  if (!isNetworkName(networkFlag)) throw new UsageError(`unknown network "${networkFlag}"; use testnet or mainnet`);
  return loadReadOnlyConfig({ HEDERA_NETWORK: networkFlag });
}

function addressFlag(value: string): Address {
  if (!isAddress(value, { strict: false })) throw new UsageError(`--vault "${value}" is not an EVM address`);
  return getAddress(value);
}

function integerFlag(flag: string, value: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError(`${flag} expects a whole number, got "${value}"`);
  return Number(value);
}

function print<T>(json: boolean, result: T, pretty: (result: T) => void): void {
  if (json) console.log(JSON.stringify(result, null, 2));
  else pretty(result);
}

function printProof(proof: TradeProof): void {
  const counts = (status: CheckStatus) => proof.checks.filter(check => check.status === status).length;
  const verdicts: Record<TradeProof["verdict"], string> = {
    verified: `VERIFIED: ${counts("pass")} checks passed${counts("warn") ? `, ${counts("warn")} with a warning` : ""}`,
    failed: `FAILED: ${counts("fail")} of ${proof.checks.length} checks failed`,
    incomplete: `INCOMPLETE: ${counts("skip")} checks lack Mirror Node data (it may still be importing); retry soon`,
  };
  const titleWidth = Math.max(...proof.checks.map(check => check.title.length));
  console.log(`Autonr trade #${proof.tradeId} on ${proof.network}`);
  console.log(`  tx        ${proof.txHash}${proof.transactionId ? ` (${proof.transactionId})` : ""}`);
  console.log(`  block     ${proof.blockNumber ?? "unknown"}, consensus ${proof.consensusTimestamp}`);
  console.log(`  vault     ${proof.vault}`);
  console.log(`  decision  topic ${proof.topicId}, message ${proof.sequence}`);
  console.log("");
  for (const check of proof.checks) {
    console.log(`  ${STATUS_LABEL[check.status]}  ${check.title.padEnd(titleWidth)}  ${check.detail}`);
  }
  console.log("");
  console.log(verdicts[proof.verdict]);
  console.log(`  trade     ${proof.links.tx}`);
  console.log(`  decision  ${proof.links.topicMessage}`);
  console.log(`  vault     ${proof.links.vault}`);
}

function printAudit(report: AuditReport): void {
  const { decisions } = report;
  console.log(`Autonr decision log audit on ${report.network}: ${report.ok ? "OK" : "GAPS FOUND"}`);
  console.log(`  topic      ${report.topicId}, messages ${report.fromSequence} to ${report.toSequence}`);
  console.log(`  vault      ${report.vault}`);
  console.log(
    `  decisions  ${decisions.trade} trade, ${decisions.hold} hold, ${decisions.rejected} rejected, ` +
      `${decisions.invalid} invalid, ${decisions.foreignPayer} paid by another account`,
  );
  console.log(
    `  trades     ${report.trades} executed, ${report.matchedTrades} backed by a decision, ` +
      `${report.unmatchedTrades.length} unbacked`,
  );
  if (report.findings.length > 0) console.log("");
  for (const finding of report.findings) {
    console.log(`  ${finding.severity === "error" ? "ERROR" : "WARN "}  ${finding.message}`);
  }
  console.log("");
  console.log(`  ${hashscanUrl(report.network, "topic", report.topicId)}`);
  console.log(`  ${hashscanUrl(report.network, "contract", report.vault)}`);
}

function printReplay(result: ReplayResult, network: NetworkName, topicId: string): void {
  const outcome = result.reproduced ? "REPRODUCED" : "NOT REPRODUCED";
  console.log(`Replay of decision ${result.sequence} on ${network}: ${outcome}`);
  console.log(`  recorded  ${result.expectedError}`);
  console.log(`  replayed  ${result.replayedError ?? "no error, the call succeeds"}`);
  console.log(`  ${result.detail}`);
  console.log(`  ${hashscanTopicMessageUrl(network, topicId, result.sequence)}`);
}
