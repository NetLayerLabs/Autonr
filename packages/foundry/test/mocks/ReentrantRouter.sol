// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAgentVault } from "../../contracts/interfaces/IAgentVault.sol";
import { ISaucerSwapV2SwapRouter } from "../../contracts/interfaces/ISaucerSwapV2SwapRouter.sol";
import { SwapPath } from "./SwapPath.sol";

/// @notice Hostile router that calls `executeSwap` again from inside the swap. Tests also make it the vault's agent,
///         so the nested call gets past `onlyAgent` and has to be stopped by the reentrancy guard.
contract ReentrantRouter is ISaucerSwapV2SwapRouter {
    IAgentVault public vault;

    function setVault(IAgentVault vault_) external {
        vault = vault_;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256) {
        (address tokenIn, uint24 fee, address tokenOut) = SwapPath.decode(params.path);
        return vault.executeSwap(
            IAgentVault.SwapRequest({ tokenIn: tokenIn, tokenOut: tokenOut, poolFee: fee, amountIn: params.amountIn }),
            IAgentVault.Reasoning({ hash: keccak256("reentry"), sequence: type(uint64).max })
        );
    }
}
