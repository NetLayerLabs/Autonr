// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISaucerSwapV2SwapRouter
/// @notice The exact-input entry point of SaucerSwap V2's SwapRouter, a Uniswap V3 (periphery v1) fork.
interface ISaucerSwapV2SwapRouter {
    /// @param path tokenIn (20 bytes) | fee (3 bytes) | tokenOut (20 bytes), repeated for multi-hop swaps.
    /// @param recipient Receiver of the output tokens.
    /// @param deadline The router reverts with "Transaction too old" once block.timestamp is past it.
    /// @param amountIn Exact amount of the first token to sell.
    /// @param amountOutMinimum The router reverts with "Too little received" below it.
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
