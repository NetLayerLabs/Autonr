#!/usr/bin/env node
// Live-tier checks for the Hedera Harness recipe. Reads only the public testnet Mirror Node: no keys, no
// dependencies, no writes. Deliberately independent of packages/agent, so an agent that breaks the agent's own
// decoder or verifier cannot also make these checks pass.
//
//   node .harness/checks/live-chain.mjs hcs     the decision topic holds >= 1 valid autonr.decision/v1 record
//   node .harness/checks/live-chain.mjs trade   the vault has a SUCCESS executeSwap that emitted TradeExecuted
//
// Options: --topic <0.0.x>  --vault <0x...>  --mirror <url>  (defaults: the reference testnet deployment)

import { parseArgs } from "node:util";

const REFERENCE = {
  topic: "0.0.10821549",
  vault: "0x037b24d59836e1C0cb9Fe571f004409D81eba472",
  mirror: "https://testnet.mirrornode.hedera.com",
};
// From packages/agent/src/abi/agentVault.ts (IAgentVault): selector of executeSwap and topic0 of TradeExecuted.
const EXECUTE_SWAP_SELECTOR = "0x931c132f";
const TRADE_EXECUTED_TOPIC0 = "0xbf4519860d55bcb089eef2af19679bb13d4e951560fecf79489864f2ceb56f63";
const SCHEMA_ID = "autonr.decision/v1";
const MAX_DECISION_BYTES = 1024;
const MAX_PAGES = 5;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    topic: { type: "string", default: REFERENCE.topic },
    vault: { type: "string", default: REFERENCE.vault },
    mirror: { type: "string", default: REFERENCE.mirror },
  },
});
const check = positionals[0];
const mirror = values.mirror.replace(/\/+$/, "");
const vault = values.vault.toLowerCase();
const topicId = values.topic;

async function get(pathOrUrl) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${mirror}${pathOrUrl}`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    throw new Error(`GET ${url} -> HTTP ${response.status}`);
  }
}

async function* pages(path, key) {
  let next = path;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const body = await get(next);
    yield* body[key] ?? [];
    next = body.links?.next ?? null;
  }
}

// --- autonr.decision/v1 structure, mirrored from packages/agent/src/decision/index.ts ---
const isHexAddress = v => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const isHash32 = v => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
const isUintString = v => typeof v === "string" && /^\d+$/.test(v);
const isDecimalString = v => typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v);
const isEntityId = v => typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v);
const isUint = v => Number.isInteger(v) && v >= 0;
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

function decisionProblems(r) {
  const p = [];
  if (!isObject(r)) return ["not a JSON object"];
  if (r.schema !== SCHEMA_ID) p.push(`schema is ${JSON.stringify(r.schema)}`);
  if (!["trade", "hold", "rejected"].includes(r.kind)) p.push("kind is not trade|hold|rejected");
  if (!["testnet", "mainnet", "previewnet", "local"].includes(r.network)) p.push("bad network");
  if (!isHexAddress(r.vault)) p.push("vault is not an address");
  if (!isEntityId(r.agent)) p.push("agent is not an entity id");
  if (typeof r.createdAt !== "string" || Number.isNaN(Date.parse(r.createdAt))) p.push("createdAt is not ISO-8601");
  const s = r.strategy;
  if (!isObject(s) || typeof s.id !== "string" || !s.id || typeof s.version !== "string" || !s.version) {
    p.push("strategy needs id and version");
  }
  if (!Array.isArray(r.market) || r.market.length > 2) p.push("market must be an array of at most 2");
  else {
    for (const m of r.market) {
      const sourced = isObject(m) && ["chainlink", "supra"].includes(m.source);
      if (!sourced || !isDecimalString(m.price) || !isUint(m.updatedAt)) {
        p.push("market entry needs source chainlink|supra, a decimal price and updatedAt");
        break;
      }
    }
  }
  if (typeof r.rationale !== "string" || r.rationale.length > 400) p.push("rationale must be a string of <= 400 chars");
  if (r.action !== undefined) {
    const a = r.action;
    const legs = isObject(a) && ["buy", "sell"].includes(a.side) && isHexAddress(a.tokenIn) && isHexAddress(a.tokenOut);
    const size = legs && isUintString(a.amountIn) && Number.isInteger(a.poolFee) && a.poolFee > 0;
    if (!size || !isDecimalString(a.usd)) p.push("action is malformed");
  }
  if (r.rejection !== undefined) {
    const j = r.rejection;
    const staged = isObject(j) && ["simulation", "execution"].includes(j.stage);
    const described = staged && typeof j.error === "string" && j.error && typeof j.detail === "string";
    if (!described || (j.txHash !== undefined && !isHash32(j.txHash))) p.push("rejection is malformed");
  }
  if (r.kind === "trade" && !r.action) p.push("a trade record needs an action");
  if (r.kind === "trade" && r.rejection) p.push("a trade record cannot carry a rejection");
  if (r.kind === "hold" && (r.action || r.rejection)) p.push("a hold record has neither action nor rejection");
  if (r.kind === "rejected" && !r.rejection) p.push("a rejected record needs a rejection");
  return p;
}

async function checkHcs() {
  const topic = await get(`/api/v1/topics/${topicId}`);
  if (!topic.submit_key) throw new Error(`topic ${topicId} has no submit key: anyone could write decisions to it`);

  const valid = [];
  const invalid = [];
  for await (const m of pages(`/api/v1/topics/${topicId}/messages?order=asc&limit=100`, "messages")) {
    const bytes = Buffer.from(m.message, "base64");
    const problems = [];
    if (m.chunk_info && m.chunk_info.total !== 1) problems.push(`chunked into ${m.chunk_info.total} parts`);
    if (bytes.length > MAX_DECISION_BYTES) problems.push(`${bytes.length} bytes > ${MAX_DECISION_BYTES}`);
    let record;
    try {
      record = JSON.parse(bytes.toString("utf8"));
    } catch {
      problems.push("not JSON");
    }
    if (record !== undefined) {
      problems.push(...decisionProblems(record));
      if (isHexAddress(record.vault) && record.vault.toLowerCase() !== vault) {
        problems.push(`cites vault ${record.vault}`);
      }
      if (record.agent !== m.payer_account_id) {
        problems.push(`paid by ${m.payer_account_id}, not the agent ${record.agent}`);
      }
    }
    (problems.length === 0 ? valid : invalid).push({ seq: m.sequence_number, kind: record?.kind, problems });
  }

  for (const v of valid) console.log(`  PASS  message ${v.seq}: ${SCHEMA_ID} ${v.kind}`);
  for (const i of invalid) console.log(`  WARN  message ${i.seq}: ${i.problems.join("; ")}`);
  if (valid.length === 0) throw new Error(`topic ${topicId} has no valid ${SCHEMA_ID} message`);
  console.log(`OK: topic ${topicId} (submit-key gated) holds ${valid.length} valid ${SCHEMA_ID} record(s)`);
}

async function checkTrade() {
  const candidates = [];
  for await (const r of pages(`/api/v1/contracts/${vault}/results?order=desc&limit=100`, "results")) {
    if (r.function_parameters?.toLowerCase().startsWith(EXECUTE_SWAP_SELECTOR)) candidates.push(r.hash);
  }
  if (candidates.length === 0) throw new Error(`vault ${values.vault} has no executeSwap call on the Mirror Node`);

  for (const hash of candidates.slice(0, 20)) {
    const tx = await get(`/api/v1/contracts/results/${hash}`);
    const log = (tx.logs ?? []).find(
      l => l.address?.toLowerCase() === vault && l.topics?.[0]?.toLowerCase() === TRADE_EXECUTED_TOPIC0,
    );
    if (tx.result !== "SUCCESS" || !log) {
      console.log(`  SKIP  ${hash}: result ${tx.result}, TradeExecuted ${log ? "present" : "absent"}`);
      continue;
    }
    // TradeReceipt is a static tuple, so it is inline in data; its last three words are reasoningHash, hcsTopicNum
    // and hcsSequence.
    const words = log.data.slice(2).match(/.{64}/g) ?? [];
    if (words.length < 3) {
      throw new Error(`TradeExecuted in ${hash} has ${words.length} data word(s); expected the TradeReceipt tuple`);
    }
    const [reasoningHash, topicNum, sequence] = words.slice(-3);
    const citedTopic = `0.0.${BigInt(`0x${topicNum}`)}`;
    console.log(`  PASS  ${hash}: SUCCESS executeSwap, TradeExecuted tradeId ${BigInt(log.topics[1])}`);
    console.log(`        cites ${citedTopic} message ${BigInt(`0x${sequence}`)}, reasoningHash 0x${reasoningHash}`);
    if (citedTopic !== topicId) throw new Error(`TradeExecuted cites topic ${citedTopic}, expected ${topicId}`);
    console.log(`OK: vault ${values.vault} executed a trade backed by an HCS decision`);
    return;
  }
  throw new Error(`none of the vault's ${candidates.length} executeSwap call(s) is a SUCCESS with TradeExecuted`);
}

const checks = { hcs: checkHcs, trade: checkTrade };
if (!checks[check]) {
  console.error("usage: node .harness/checks/live-chain.mjs hcs|trade [--topic 0.0.x] [--vault 0x...] [--mirror url]");
  process.exit(2);
}
try {
  await checks[check]();
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
