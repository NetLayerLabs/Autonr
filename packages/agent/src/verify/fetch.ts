import { type Address, decodeFunctionData, getAbiItem, type Hex, size, slice, toFunctionSelector } from "viem";
import { agentVaultAbi } from "../abi/agentVault";
import { entityIdFromLongZero, entityIdFromNum } from "../hedera";
import { type ContractAction, type MirrorClient, orNull } from "../mirror";
import { getNetwork, type NetworkName } from "../networks";
import { VerifyError } from "./errors";
import { mirrorFor, transactionReference } from "./input";
import { readTradeContext } from "./onchain";
import { decodeTradeExecuted } from "./receipt";
import { type TraceCall, type TradeEvidence } from "./types";

const EXECUTE_SWAP = toFunctionSelector(getAbiItem({ abi: agentVaultAbi, name: "executeSwap" }));

/**
 * Gathers the evidence for one trade from public Mirror Node data only: the transaction and its TradeExecuted event,
 * the code of the contract that emitted it, the decision message it points at, the topic's submit key, the agent's account, vault settings and oracle state
 * re-read at the trade's block, and the call trace. Throws VerifyError for an unknown or non-trade transaction; data
 * the Mirror Node cannot provide yet is left null so the matching checks are skipped rather than failed.
 */
export async function fetchTradeEvidence(input: {
  network: NetworkName;
  tx: string;
  mirrorUrl?: string;
}): Promise<TradeEvidence> {
  const mirror = mirrorFor(input.network, input.mirrorUrl);
  const network = getNetwork(input.network);
  const reference = transactionReference(input.tx);
  const result = await orNull(mirror.contractResult(reference));
  if (!result) {
    const hint = "check the network; a new transaction appears within seconds";
    throw new VerifyError("not-found", `transaction ${input.tx} is not on the ${input.network} Mirror Node (${hint})`);
  }
  const tradeLog = result.logs
    .map(log => ({ log, trade: decodeTradeExecuted(log) }))
    .find(entry => entry.trade !== null);
  if (!tradeLog?.trade) {
    throw new VerifyError(
      "not-a-trade",
      `transaction ${input.tx} (${result.result}) emitted no AgentVault TradeExecuted event`,
    );
  }
  const { trade, log } = tradeLog;
  const vault = log.address;
  const block = result.block_number;

  const [context, message, actions, transactionId, contract] = await Promise.all([
    block === null
      ? null
      : readTradeContext(mirror, {
          vault,
          tokenIn: trade.tokenIn,
          tokenOut: trade.tokenOut,
          block,
          supra: network.supra,
        }),
    fetchMessage(mirror, entityIdFromNum(BigInt(trade.receipt.hcsTopicNum)), trade.receipt.hcsSequence),
    orNull(mirror.contractActions(result.hash)),
    // Contract results do not carry the Hedera transaction id, so a hash input is resolved by consensus timestamp.
    reference.startsWith("0x") ? orNull(mirror.transactionIdAt(result.timestamp)) : reference,
    // By entity id: the emitting contract is what must be checked, whatever address the log reports it under.
    orNull(mirror.contract(log.contract_id)),
  ]);
  const oracleConfig = context?.oracleConfig ?? null;
  const [agentAccount, addressBook] = await Promise.all([
    context?.agent ? fetchAccount(mirror, context.agent, result.timestamp) : null,
    knownContracts(mirror, network.supra, { address: vault, contractId: log.contract_id }, oracleConfig),
  ]);

  return {
    network: input.network,
    txHash: result.hash,
    transactionId,
    consensusTimestamp: result.timestamp,
    blockNumber: block,
    result: result.result,
    from: result.from,
    vault,
    vaultCode: contract?.runtime_bytecode ?? null,
    vaultRouterAtBlock: context?.router ?? null,
    vaultSupraAtBlock: context?.supra ?? null,
    tradeId: trade.tradeId,
    tokenIn: trade.tokenIn,
    tokenOut: trade.tokenOut,
    receipt: trade.receipt,
    ...requestedSwap(result.function_parameters),
    vaultTopicNumAtBlock: context?.topicNum ?? null,
    vaultAgentAtBlock: context?.agent ?? null,
    agentAccount,
    message,
    oracleAtBlock: context?.oracleAtBlock ?? null,
    oracleConfigAtBlock: oracleConfig,
    // Every contract call has at least its top-level frame, so no actions means the trace is not imported yet.
    trace: actions && actions.length > 0 ? toTrace(actions, addressBook) : null,
    policyMaxSlippageBps: context?.maxSlippageBps ?? null,
  };
}

async function fetchMessage(
  mirror: MirrorClient,
  topicId: string,
  sequence: number,
): Promise<TradeEvidence["message"]> {
  const message = await orNull(mirror.topicMessage(topicId, sequence));
  if (!message) return null;
  const topic = await mirror.topic(topicId);
  return {
    raw: message.message,
    consensusTimestamp: message.consensus_timestamp,
    payer: message.payer_account_id,
    topicSubmitKey: topic.submit_key && { type: topic.submit_key._type, key: topic.submit_key.key },
  };
}

/** The account behind an EVM address as of `at`, so a later key rotation does not rewrite history. */
async function fetchAccount(
  mirror: MirrorClient,
  address: Address,
  at: string,
): Promise<TradeEvidence["agentAccount"]> {
  const account = await orNull(mirror.account(address, at));
  return (
    account && {
      accountId: account.account,
      evmAddress: account.evm_address,
      key: account.key && { type: account.key._type, key: account.key.key },
    }
  );
}

/** The fee tier and amount the agent requested, when the transaction called executeSwap directly. */
function requestedSwap(calldata: Hex | null): Pick<TradeEvidence, "poolFee" | "requestedAmountIn"> {
  const unknown = { poolFee: null, requestedAmountIn: null };
  if (!calldata?.toLowerCase().startsWith(EXECUTE_SWAP)) return unknown;
  try {
    const call = decodeFunctionData({ abi: agentVaultAbi, data: calldata });
    if (call.functionName !== "executeSwap") return unknown;
    return { poolFee: call.args[0].poolFee, requestedAmountIn: call.args[0].amountIn.toString() };
  } catch {
    // The selector matched but the arguments do not decode: a lookalike's calldata, judged by the other checks.
    return unknown;
  }
}

/**
 * Maps entity ids to the EVM addresses the vault knows them by. Mirror Node actions name every contract by its
 * long-zero address, but the vault and the oracle feeds were deployed through the EVM and are configured by their
 * CREATE addresses, so the trace would not match them otherwise.
 */
async function knownContracts(
  mirror: MirrorClient,
  supra: Address,
  vault: { address: Address; contractId: string },
  oracleConfig: TradeEvidence["oracleConfigAtBlock"],
): Promise<Map<string, Address>> {
  const feeds = [oracleConfig?.tokenIn?.chainlinkFeed, oracleConfig?.tokenOut?.chainlinkFeed].filter(
    (feed): feed is Address => Boolean(feed),
  );
  const book = new Map<string, Address>([[vault.contractId, vault.address]]);
  await Promise.all(
    [...new Set([supra, ...feeds])].map(async address => {
      const longZeroId = entityIdFromLongZero(address);
      if (longZeroId) {
        book.set(longZeroId, address);
        return;
      }
      // An address with no contract behind it simply never matches a call in the trace.
      const contract = await orNull(mirror.contract(address));
      if (contract) book.set(contract.contract_id, address);
    }),
  );
  return book;
}

function toTrace(actions: ContractAction[], book: Map<string, Address>): TraceCall[] {
  return actions.flatMap(action => {
    const to = (action.recipient ? book.get(action.recipient) : undefined) ?? action.to;
    if (!to) return [];
    const call: TraceCall = {
      depth: action.call_depth,
      caller: book.get(action.caller) ?? action.from,
      to,
      selector: action.input && size(action.input) >= 4 ? slice(action.input, 0, 4) : "0x",
      resultOk: action.result_data_type === "OUTPUT",
    };
    return [call];
  });
}
