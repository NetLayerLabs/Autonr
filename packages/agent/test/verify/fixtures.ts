import {
  type Abi,
  type Address,
  concat,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionReturnType,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  type EncodeFunctionDataParameters,
  encodeFunctionResult,
  type EncodeFunctionResultParameters,
  getAbiItem,
  getAddress,
  type Hex,
  pad,
  parseAbi,
  toFunctionSelector,
  zeroAddress,
} from "viem";
import { agentVaultAbi } from "../../src/abi/agentVault";
import { agentVaultImmutableReferences, agentVaultRuntimeBytecode } from "../../src/abi/agentVaultCode";
import { DECISION_SCHEMA_ID, type DecisionRecord, encodeDecision, type Rejection } from "../../src/decision";
import { longZeroAddress } from "../../src/hedera";
import { NETWORKS } from "../../src/networks";
import { chainlinkAggregatorAbi } from "../../src/oracles/chainlink";
import { supraPushOracleAbi } from "../../src/oracles/supra";
import { FakeMirror } from "./fake-mirror";

/**
 * A complete, honest testnet trade as the Mirror Node would serve it: the agent published a "trade" record to HCS
 * (sequence 42), then sold 10 WHBAR for USDC through the vault 3.4 s later. Prices and amounts come from the shared
 * oracle-math vectors, so the receipt is exactly what the vault would emit for this state.
 */

export const MIRROR_URL = "https://mirror.test";

const testnet = NETWORKS.testnet;
// Checksummed, as viem decodes addresses; networks.ts spells some of them in lowercase.
export const WHBAR = getAddress(testnet.baseToken.address);
export const USDC = getAddress(testnet.quoteToken.address);
export const ROUTER = getAddress(testnet.saucerswap.router);
export const SUPRA = getAddress(testnet.supra);
export const FEED = getAddress("0x59bc155eb6c6c415fe43255af66ecf0523c92b4a");
const FEED_ID = "0.0.4870176";
const FEED_AGGREGATOR_ID = "0.0.4870175";
const SUPRA_ID = "0.0.2664858";
const SUPRA_IMPLEMENTATION_ID = "0.0.2664857";
const ROUTER_ID = "0.0.1414040";
const POOL_ID = "0.0.9283328";
const WHBAR_ID = testnet.baseToken.id;
const USDC_ID = testnet.quoteToken.id;

/** Deployed through JSON-RPC, so its EVM address is a CREATE address, not the long-zero form of its id. */
export const VAULT = getAddress("0x5fbdb2315678afecb367f032d93f642f64180aa3");
export const VAULT_ID = "0.0.6100001";
export const AGENT_ID = "0.0.6200001";
/** The agent's alias: an ECDSA account's EVM address, which is what msg.sender and vault.agent() hold. */
export const AGENT_ADDRESS = getAddress("0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199");
export const AGENT_KEY = {
  _type: "ECDSA_SECP256K1",
  key: "02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc",
};
export const TOPIC_ID = "0.0.6300001";
const TOPIC_NUM = 6_300_001n;
const TOPIC_CREATED_AT = "1789990000.000000000";

export const BLOCK = 41_000_000;
export const TX_HASH: Hex = `0x${"ab".repeat(32)}`;
export const TRANSACTION_ID = "0.0.7314364-1790000001-123456789";
const SEQUENCE = 42;
const MESSAGE_AT = "1790000000.100000000";
export const TRADE_AT = "1790000003.500000001";
const TRADE_ID = 7n;
const POOL_FEE = 3000;
const MAX_SLIPPAGE_BPS = 300;

const AMOUNT_IN = 1_000_000_000n;
const CHAINLINK_UPDATED_AT = 1_789_999_990n;
const SUPRA_HBAR_TIME_MS = 1_789_999_000_123n;
const SUPRA_USDC_TIME_MS = 1_789_998_000_456n;

export function tradeRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    schema: DECISION_SCHEMA_ID,
    kind: "trade",
    network: "testnet",
    vault: VAULT,
    agent: AGENT_ID,
    createdAt: "2026-09-21T12:26:39.000Z",
    strategy: { id: "rebalance", version: "1" },
    market: [
      {
        feed: "HBAR/USD",
        source: "chainlink",
        price: "0.10245",
        updatedAt: 1789999990,
        crossCheck: "0.10328",
        divergenceBps: 81,
      },
      { feed: "USDC/USD", source: "supra", price: "0.99997", updatedAt: 1789998000 },
    ],
    action: {
      side: "sell",
      tokenIn: WHBAR,
      tokenOut: USDC,
      amountIn: AMOUNT_IN.toString(),
      poolFee: POOL_FEE,
      usd: "1.02",
    },
    rationale:
      "WHBAR is 62% of the vault against a 50% target; selling $1.02 of it moves the vault back toward the target.",
    ...overrides,
  };
}

export function holdRecord(rationale = "Within 5% of the target weight; holding."): DecisionRecord {
  const { action: _action, ...record } = tradeRecord({ kind: "hold", rationale });
  return record;
}

export function rejectedRecord(rejection: Rejection, overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return tradeRecord({ kind: "rejected", rationale: "The vault refused the trade.", rejection, ...overrides });
}

type ScenarioOptions = {
  /** The record the agent published; the vault commits to its hash. */
  record?: DecisionRecord;
  /** amountIn the vault actually executed. */
  amountIn?: bigint;
  messageAt?: string;
  payer?: string;
  submitKey?: { _type: string; key: string } | null;
};

/** Registers the honest trade on a fresh FakeMirror. Tests then tamper with it. */
export function tradeScenario(options: ScenarioOptions = {}) {
  const record = options.record ?? tradeRecord();
  const decision = encodeDecision(record);
  const amountIn = options.amountIn ?? AMOUNT_IN;
  const mirror = new FakeMirror()
    .route(`/api/v1/contracts/results/${TX_HASH}`, contractResult(decision.hash, amountIn))
    .route(`/api/v1/contracts/results/${TX_HASH}/actions`, { actions: tradeActions(), links: { next: null } })
    .route("/api/v1/transactions", { transactions: [{ transaction_id: TRANSACTION_ID, name: "ETHEREUMTRANSACTION" }] })
    .route(`/api/v1/topics/${TOPIC_ID}`, topic(options.submitKey === undefined ? AGENT_KEY : options.submitKey))
    .route(`/api/v1/topics/${TOPIC_ID}/messages/${SEQUENCE}`, {
      ...hcsMessage(SEQUENCE, decision.json, { payer: options.payer }),
      consensus_timestamp: options.messageAt ?? MESSAGE_AT,
    })
    .route(`/api/v1/accounts/${AGENT_ADDRESS}`, agentAccount())
    .route(`/api/v1/contracts/${VAULT_ID}`, vaultContract(deployedVaultCode()))
    .route(`/api/v1/contracts/${FEED}`, { contract_id: FEED_ID, evm_address: FEED.toLowerCase() })
    .route(`/api/v1/contracts/${SUPRA}`, { contract_id: SUPRA_ID, evm_address: SUPRA.toLowerCase() });
  stubChainState(mirror, BLOCK);
  return { mirror, record, decision };
}

/** `/contracts/{id}` for the vault, serving `runtimeBytecode` as its deployed code. */
export function vaultContract(runtimeBytecode: Hex) {
  return {
    contract_id: VAULT_ID,
    evm_address: VAULT.toLowerCase(),
    created_timestamp: TOPIC_CREATED_AT,
    runtime_bytecode: runtimeBytecode,
  };
}

/** The compiled AgentVault with its immutables filled in, as a real deployment's code reads. */
export function deployedVaultCode(): Hex {
  let hex = agentVaultRuntimeBytecode.slice(2);
  for (const { start, length } of agentVaultImmutableReferences) {
    const value = pad(ROUTER, { size: length }).slice(2);
    hex = `${hex.slice(0, start * 2)}${value}${hex.slice((start + length) * 2)}`;
  }
  return `0x${hex}`;
}

/** Vault settings and oracle state at `block`, matching the receipt the scenario's vault emitted. */
export function stubChainState(mirror: FakeMirror, block: number | "latest"): void {
  const vault = { address: VAULT, abi: agentVaultAbi } as const;
  stubView(mirror, block, { ...vault, functionName: "ROUTER", result: ROUTER });
  stubView(mirror, block, { ...vault, functionName: "SUPRA", result: SUPRA });
  stubView(mirror, block, { ...vault, functionName: "hcsTopicNum", result: TOPIC_NUM });
  stubView(mirror, block, { ...vault, functionName: "agent", result: AGENT_ADDRESS });
  stubView(mirror, block, {
    ...vault,
    functionName: "policy",
    result: {
      maxTradeUsd: 25n * 10n ** 18n,
      dailyCapUsd: 100n * 10n ** 18n,
      cooldown: 300,
      maxPriceAge: 3600,
      maxSlippageBps: MAX_SLIPPAGE_BPS,
      maxOracleDivergenceBps: 100,
    },
  });
  stubView(mirror, block, {
    ...vault,
    functionName: "tokenConfig",
    args: [WHBAR],
    result: { allowed: true, decimals: 8, chainlinkFeed: FEED, supraPairId: 75, supraEnabled: true },
  });
  stubView(mirror, block, {
    ...vault,
    functionName: "tokenConfig",
    args: [USDC],
    result: { allowed: true, decimals: 6, chainlinkFeed: zeroAddress, supraPairId: 89, supraEnabled: true },
  });
  const feed = { address: FEED, abi: chainlinkAggregatorAbi } as const;
  stubView(mirror, block, {
    ...feed,
    functionName: "latestRoundData",
    result: [110680464442257320000n, 10_245_000n, CHAINLINK_UPDATED_AT, CHAINLINK_UPDATED_AT, 110680464442257320000n],
  });
  stubView(mirror, block, { ...feed, functionName: "decimals", result: 8 });
  stubSupra(mirror, block, 75n, { decimals: 18n, time: SUPRA_HBAR_TIME_MS, price: 103_280_000_000_000_000n });
  stubSupra(mirror, block, 89n, { decimals: 8n, time: SUPRA_USDC_TIME_MS, price: 99_997_000n });
}

function stubSupra(
  mirror: FakeMirror,
  block: number | "latest",
  pair: bigint,
  feed: { decimals: bigint; time: bigint; price: bigint },
): void {
  stubView(mirror, block, {
    address: SUPRA,
    abi: supraPushOracleAbi,
    functionName: "getSvalue",
    args: [pair],
    result: { round: feed.time, ...feed },
  });
}

export function stubView<const abi extends Abi, name extends ContractFunctionName<abi, "view">>(
  mirror: FakeMirror,
  block: number | "latest",
  call: {
    address: Address;
    abi: abi;
    functionName: name;
    args?: ContractFunctionArgs<abi, "view", name>;
    result: ContractFunctionReturnType<abi, "view", name>;
  },
): void {
  const { address, abi, functionName, args, result } = call;
  const data = encodeFunctionData({ abi, functionName, args } as EncodeFunctionDataParameters);
  const encoded = encodeFunctionResult({ abi, functionName, result } as EncodeFunctionResultParameters);
  mirror.contractCall(address, data, block, { result: encoded });
}

const tradeExecuted = getAbiItem({ abi: agentVaultAbi, name: "TradeExecuted" });
const erc20Transfer = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const swapRouterAbi = parseAbi([
  "struct Params { bytes path; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; }",
  "function exactInput(Params params) payable returns (uint256 amountOut)",
]);

function receiptFor(reasoningHash: Hex, amountIn: bigint, overrides: { sequence?: number } = {}) {
  return {
    amountIn,
    amountOut: 1_030_000n,
    minAmountOut: 993_794n,
    usdValue: 1_024_500_000_000_000_000n,
    oracleIn: {
      priceE18: 102_450_000_000_000_000n,
      updatedAt: CHAINLINK_UPDATED_AT,
      crossCheckE18: 103_280_000_000_000_000n,
      crossCheckUpdatedAt: SUPRA_HBAR_TIME_MS / 1000n,
      divergenceBps: 81n,
    },
    oracleOut: {
      priceE18: 999_970_000_000_000_000n,
      updatedAt: SUPRA_USDC_TIME_MS / 1000n,
      crossCheckE18: 0n,
      crossCheckUpdatedAt: 0n,
      divergenceBps: 0n,
    },
    reasoningHash,
    hcsTopicNum: TOPIC_NUM,
    hcsSequence: BigInt(overrides.sequence ?? SEQUENCE),
  };
}

function tradeExecutedLog(tradeId: bigint, receipt: ReturnType<typeof receiptFor>) {
  return {
    address: VAULT.toLowerCase(),
    bloom: "0x00",
    contract_id: VAULT_ID,
    data: encodeAbiParameters([tradeExecuted.inputs[3]], [receipt]),
    index: 4,
    topics: encodeEventTopics({
      abi: agentVaultAbi,
      eventName: "TradeExecuted",
      args: { tradeId, tokenIn: WHBAR, tokenOut: USDC },
    }),
  };
}

function contractResult(reasoningHash: Hex, amountIn: bigint) {
  const receipt = receiptFor(reasoningHash, amountIn);
  const usdcTransfer = {
    address: USDC.toLowerCase(),
    bloom: "0x00",
    contract_id: USDC_ID,
    data: encodeAbiParameters([{ type: "uint256" }], [receipt.amountOut]),
    index: 2,
    topics: encodeEventTopics({
      abi: erc20Transfer,
      eventName: "Transfer",
      args: { from: longZeroAddress(POOL_ID), to: VAULT },
    }),
  };
  return {
    address: VAULT.toLowerCase(),
    amount: 0,
    block_number: BLOCK,
    call_result: encodeAbiParameters([{ type: "uint256" }], [receipt.amountOut]),
    chain_id: "0x128",
    contract_id: VAULT_ID,
    error_message: null,
    // The Mirror Node names the sender by its long-zero address, not by the alias that signed the transaction.
    from: longZeroAddress(AGENT_ID),
    function_parameters: encodeFunctionData({
      abi: agentVaultAbi,
      functionName: "executeSwap",
      args: [
        { tokenIn: WHBAR, tokenOut: USDC, poolFee: POOL_FEE, amountIn },
        { hash: reasoningHash, sequence: BigInt(SEQUENCE) },
      ],
    }),
    gas_limit: 1_200_000,
    gas_used: 412_345,
    hash: TX_HASH,
    logs: [usdcTransfer, tradeExecutedLog(TRADE_ID, receipt)],
    result: "SUCCESS",
    status: "0x1",
    timestamp: TRADE_AT,
    to: VAULT.toLowerCase(),
    type: 2,
  };
}

type ActionOptions = { result?: "OUTPUT" | "REVERT_REASON"; operation?: string };

export function action(
  index: number,
  depth: number,
  caller: string,
  recipient: string,
  input: Hex,
  options: ActionOptions = {},
) {
  return {
    call_depth: depth,
    call_operation_type: options.operation ?? (depth === 0 ? "CALL" : "STATICCALL"),
    call_type: "CALL",
    caller,
    caller_type: caller === AGENT_ID ? "ACCOUNT" : "CONTRACT",
    from: longZeroAddress(caller),
    gas: 400_000,
    gas_used: 21_000,
    index,
    input,
    recipient,
    recipient_type: "CONTRACT",
    result_data: "0x",
    result_data_type: options.result ?? "OUTPUT",
    timestamp: TRADE_AT,
    to: longZeroAddress(recipient),
    value: 0,
  };
}

/** Calldata for calls the verifier only recognises by selector. */
function call(selector: Hex): Hex {
  return concat([selector, pad("0x", { size: 64 })]);
}

/** The trade's call tree in Mirror Node form: both oracles read through their proxies, then the swap. */
export function tradeActions() {
  const latestRoundData = encodeFunctionData({ abi: chainlinkAggregatorAbi, functionName: "latestRoundData" });
  const decimals = encodeFunctionData({ abi: chainlinkAggregatorAbi, functionName: "decimals" });
  const getSvalue = (pair: bigint) =>
    encodeFunctionData({ abi: supraPushOracleAbi, functionName: "getSvalue", args: [pair] });
  const exactInput = encodeFunctionData({
    abi: swapRouterAbi,
    functionName: "exactInput",
    args: [
      {
        path: concat([WHBAR, "0x000bb8", USDC]),
        recipient: VAULT,
        deadline: 1790000003n,
        amountIn: AMOUNT_IN,
        amountOutMinimum: 993_794n,
      },
    ],
  });
  return [
    action(0, 0, AGENT_ID, VAULT_ID, call(toFunctionSelector(getAbiItem({ abi: agentVaultAbi, name: "executeSwap" })))),
    action(1, 1, VAULT_ID, FEED_ID, latestRoundData),
    action(2, 2, FEED_ID, FEED_AGGREGATOR_ID, latestRoundData),
    action(3, 1, VAULT_ID, FEED_ID, decimals),
    action(4, 1, VAULT_ID, SUPRA_ID, getSvalue(75n)),
    action(5, 2, SUPRA_ID, SUPRA_IMPLEMENTATION_ID, getSvalue(75n), { operation: "DELEGATECALL" }),
    action(6, 1, VAULT_ID, SUPRA_ID, getSvalue(89n)),
    action(7, 2, SUPRA_ID, SUPRA_IMPLEMENTATION_ID, getSvalue(89n), { operation: "DELEGATECALL" }),
    action(8, 1, VAULT_ID, WHBAR_ID, call("0x095ea7b3"), { operation: "CALL" }),
    action(9, 1, VAULT_ID, USDC_ID, call("0x70a08231")),
    action(10, 1, VAULT_ID, ROUTER_ID, exactInput, { operation: "CALL" }),
    action(11, 2, ROUTER_ID, POOL_ID, call("0x128acb08"), { operation: "CALL" }),
    action(12, 3, POOL_ID, USDC_ID, call("0xa9059cbb"), { operation: "CALL" }),
    action(13, 3, POOL_ID, ROUTER_ID, call("0xfa461e33"), { operation: "CALL" }),
    action(14, 4, ROUTER_ID, WHBAR_ID, call("0x23b872dd"), { operation: "CALL" }),
    action(15, 1, VAULT_ID, USDC_ID, call("0x70a08231")),
  ];
}

function topic(submitKey: { _type: string; key: string } | null) {
  return {
    admin_key: { _type: "ECDSA_SECP256K1", key: "03b1c6e9b5d9f0a1f4b3b7f0e2d4c6a8b0c2e4f6a8b0c2e4f6a8b0c2e4f6a8b0c2" },
    auto_renew_account: null,
    auto_renew_period: 7_776_000,
    created_timestamp: TOPIC_CREATED_AT,
    custom_fees: { created_timestamp: TOPIC_CREATED_AT, fixed_fees: [] },
    deleted: false,
    fee_exempt_key_list: [],
    fee_schedule_key: null,
    memo: "autonr decisions",
    submit_key: submitKey,
    timestamp: { from: TOPIC_CREATED_AT, to: null },
    topic_id: TOPIC_ID,
  };
}

export function agentAccount() {
  return {
    account: AGENT_ID,
    alias: "HIQQEKFSH6TLGHLMH2RM4XQAWT4W6ZSVPPTMSPDMHR56EBXJYQVMOAN2",
    balance: { balance: 2_500_000_000, timestamp: TRADE_AT, tokens: [] },
    created_timestamp: "1789980000.000000000",
    deleted: false,
    ethereum_nonce: 12,
    evm_address: AGENT_ADDRESS.toLowerCase(),
    key: AGENT_KEY,
    max_automatic_token_associations: -1,
    memo: "",
    transactions: [],
    links: { next: null },
  };
}

/** A topic message as `/topics/{id}/messages` serves it; consensus times are 10 s apart per sequence number. */
export function hcsMessage(sequence: number, content: string | DecisionRecord, options: { payer?: string } = {}) {
  const text = typeof content === "string" ? content : encodeDecision(content).json;
  return {
    chunk_info: null,
    consensus_timestamp: messageTimestamp(sequence),
    message: Buffer.from(text, "utf8").toString("base64"),
    payer_account_id: options.payer ?? AGENT_ID,
    running_hash: "fLb23pWOvIvMdBP6ahohLhXQWNQg795SYW2tq15M7rPeCFmmYaYjfW7SoEMH9mwV",
    running_hash_version: 3,
    sequence_number: sequence,
    topic_id: TOPIC_ID,
  };
}

export function messageTimestamp(sequence: number): string {
  return `${1_790_000_000 + sequence * 10}.000000000`;
}

/** A TradeExecuted log as `/contracts/{vault}/results/logs` serves it. */
export function vaultTradeLog(options: { tradeId: number; sequence: number; reasoningHash: Hex; at: string }) {
  const receipt = receiptFor(options.reasoningHash, AMOUNT_IN, { sequence: options.sequence });
  return {
    ...tradeExecutedLog(BigInt(options.tradeId), receipt),
    block_hash: `0x${"cd".repeat(48)}`,
    block_number: BLOCK + options.tradeId,
    root_contract_id: VAULT_ID,
    timestamp: options.at,
    transaction_hash: `0x${options.tradeId.toString(16).padStart(64, "0")}`,
    transaction_index: 1,
  };
}

/** Some other vault event, which trade listings must skip. */
export function vaultPolicyLog(at: string) {
  const policyUpdated = getAbiItem({ abi: agentVaultAbi, name: "PolicyUpdated" });
  return {
    address: VAULT.toLowerCase(),
    bloom: "0x00",
    contract_id: VAULT_ID,
    data: encodeAbiParameters(policyUpdated.inputs, [
      { maxTradeUsd: 1n, dailyCapUsd: 1n, cooldown: 0, maxPriceAge: 60, maxSlippageBps: 1, maxOracleDivergenceBps: 1 },
    ]),
    index: 0,
    topics: encodeEventTopics({ abi: agentVaultAbi, eventName: "PolicyUpdated" }),
    block_hash: `0x${"ef".repeat(48)}`,
    block_number: BLOCK,
    root_contract_id: VAULT_ID,
    timestamp: at,
    transaction_hash: `0x${"ef".repeat(32)}`,
    transaction_index: 0,
  };
}
