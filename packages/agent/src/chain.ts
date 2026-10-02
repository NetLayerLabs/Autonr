import {
  type Account,
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  multicall3Abi,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hedera, hederaTestnet } from "viem/chains";
import { type ReadOnlyConfig } from "./config";
import { type NetworkName } from "./networks";

/** Multicall3 sits at its canonical address on both Hedera networks (checked on-chain 2026-10-01). */
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/** Ceiling for every transaction the agent sends: a swap through the vault needs well under a third of it. */
const MAX_GAS = 3_000_000n;

const VIEM_CHAINS: Record<NetworkName, Chain> = { testnet: hederaTestnet, mainnet: hedera };

type RpcTarget = Pick<ReadOnlyConfig, "network" | "rpcUrl">;

export type HederaPublicClient = PublicClient<Transport, Chain>;
export type HederaWalletClient = WalletClient<Transport, Chain, Account>;

function hederaChain(target: RpcTarget): Chain {
  return defineChain({
    ...VIEM_CHAINS[target.network],
    rpcUrls: { default: { http: [target.rpcUrl] } },
    contracts: { multicall3: { address: MULTICALL3 } },
  });
}

/**
 * Reads issued together are folded into one Multicall3 call (`batch.multicall`): a vault snapshot is about twenty
 * reads, and the public relays rate-limit per request. Calls that set `from` are never batched, so simulations still
 * run as the account they name.
 */
export function readClient(target: RpcTarget): HederaPublicClient {
  return createPublicClient({
    chain: hederaChain(target),
    transport: http(target.rpcUrl),
    batch: { multicall: true },
    pollingInterval: 2_000,
  });
}

export function walletClient(target: RpcTarget, privateKey: Hex): HederaWalletClient {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: hederaChain(target),
    transport: http(target.rpcUrl),
  });
}

/** Consensus time of the latest block, in unix seconds: the clock the vault's staleness and cooldown checks use. */
export async function chainTimestamp(client: HederaPublicClient): Promise<number> {
  const timestamp = await client.readContract({
    address: MULTICALL3,
    abi: multicall3Abi,
    functionName: "getCurrentBlockTimestamp",
  });
  return Number(timestamp);
}

/**
 * The relay estimates gas by simulating on a Mirror Node, and HTS system-contract work (the swap moves HTS tokens) can
 * cost the consensus node more than that simulation saw, hence 30% headroom. The cap bounds what a runaway estimate
 * can reserve: the payer must hold gas limit x gas price before the relay accepts the transaction.
 */
export function withGasHeadroom(estimate: bigint): bigint {
  if (estimate > MAX_GAS) throw new RangeError(`gas estimate ${estimate} exceeds the ${MAX_GAS} cap`);
  const padded = (estimate * 13n) / 10n;
  return padded < MAX_GAS ? padded : MAX_GAS;
}

/** `value` is in weibars: the relay scales JSON-RPC values to 18 decimals, while the EVM sees tinybars. */
type ContractCall = { to: Address; data: Hex; value?: bigint };

/**
 * Estimates, signs and submits a contract call; returns the transaction hash. A revert during estimation throws
 * before anything is sent. Hedera prices gas from its fee schedule rather than a fee market, so EIP-1559 tips buy
 * nothing: a legacy transaction at eth_gasPrice states the price exactly.
 */
export async function sendContractCall(
  client: HederaPublicClient,
  wallet: HederaWalletClient,
  call: ContractCall,
): Promise<Hex> {
  const [estimate, gasPrice] = await Promise.all([
    client.estimateGas({ account: wallet.account, ...call }),
    client.getGasPrice(),
  ]);
  return wallet.sendTransaction({ ...call, gas: withGasHeadroom(estimate), gasPrice, type: "legacy" });
}

/** Hedera reaches consensus in seconds; a minute without a receipt means the relay lost track of the transaction. */
export function waitForReceipt(client: HederaPublicClient, hash: Hex): Promise<TransactionReceipt> {
  return client.waitForTransactionReceipt({ hash, timeout: 60_000 });
}
