import { AccountId, Client, PrivateKey, type PublicKey, WebClient } from "@hiero-ledger/sdk";
import { type Hex } from "viem";
import { type NetworkName } from "../networks";

/**
 * The SDK's Node typings only name the native-gRPC client, but every transaction executes against the base client
 * class at runtime, so the gRPC-web client is used through the same type.
 */
export type HederaClient = Client;

/**
 * A Hedera SDK client whose operator is `accountId`: that account signs and pays for every transaction it submits.
 * The agent publishes its decisions through a client built from its own account and key, which is what ties the HCS
 * log to the EVM trades: one secp256k1 key is both the topic's submit key and the vault's agent.
 *
 * Transport defaults to gRPC-web over HTTPS (port 443). Native gRPC reaches the nodes on ports 50211/50212, which many
 * VPNs, corporate firewalls and some ISPs silently break: the TCP connection opens but every call ends in
 * DEADLINE_EXCEEDED. Set HEDERA_GRPC_TRANSPORT=native to use native gRPC anyway.
 * Callers close the client when done so the process can exit.
 */
export function hederaClient(network: NetworkName, accountId: string, privateKey: Hex): HederaClient {
  const operatorId = AccountId.fromString(accountId);
  const operatorKey = PrivateKey.fromStringECDSA(privateKey);
  // These clients live for one tick or one setup run, so the periodic address-book refresh is not needed.
  const configuration = { network, scheduleNetworkUpdate: false };
  const client =
    process.env.HEDERA_GRPC_TRANSPORT === "native"
      ? Client.forName(network, configuration)
      : (new WebClient(configuration) as unknown as Client);
  return client.setOperator(operatorId, operatorKey);
}

export function ecdsaPublicKey(privateKey: Hex): PublicKey {
  return PrivateKey.fromStringECDSA(privateKey).publicKey;
}
