import { useQuery } from "@tanstack/react-query";
import { hardhat } from "viem/chains";
import { useAccount } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

/**
 * Returns true when the user is on the local chain (viem's `hardhat` definition: chain id 31337, which anvil uses too)
 * and the connection fails, e.g. because no local node is running.
 */
export function useLocalChainConnectionError(): boolean {
  const { chain, isConnected } = useAccount();

  const isOnLocalFork = isConnected && chain?.id === hardhat.id;

  const { isError } = useQuery({
    queryKey: ["localChainConnection", chain?.id],
    queryFn: async () => {
      const client = getPublicClient(wagmiConfig, { chainId: hardhat.id });
      if (!client) throw new Error("No client");
      await client.getBlockNumber();
      return true;
    },
    enabled: isOnLocalFork,
    retry: false,
    staleTime: 5000,
  });

  return isOnLocalFork && isError;
}
