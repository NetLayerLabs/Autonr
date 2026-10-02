import { parseAbi } from "viem";

// SaucerSwap V2 is a Uniswap V3 fork whose router is periphery v1, so swap params still carry a deadline. Every
// fragment below was exercised with eth_call against the testnet deployment (addresses in ../networks.ts).

/** QuoterV2 simulates the swap and reverts internally to return the result, so it is not `view`: use eth_call. */
export const quoterV2Abi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const factoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);

export const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);

export const swapRouterAbi = parseAbi([
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function refundETH() payable",
]);

/** The WHBAR contract (not the WHBAR token): `deposit()` mints the HTS token 1:1 for the tinybars sent. */
export const whbarAbi = parseAbi(["function deposit() payable"]);
