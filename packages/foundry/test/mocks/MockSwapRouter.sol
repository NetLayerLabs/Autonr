// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ISaucerSwapV2SwapRouter } from "../../contracts/interfaces/ISaucerSwapV2SwapRouter.sol";
import { SwapPath } from "./SwapPath.sol";

/// @notice SaucerSwap V2 SwapRouter stand-in. Swaps at a fixed rate per token pair out of its own balance and keeps
///         the real router's deadline and minimum-output checks, with the same revert strings.
contract MockSwapRouter is ISaucerSwapV2SwapRouter {
    using SafeERC20 for IERC20;

    uint256 private constant RATE_SCALE = 1e18;

    /// @notice Raw tokenOut units paid per raw tokenIn unit, scaled by 1e18.
    mapping(address tokenIn => mapping(address tokenOut => uint256 rateE18)) public rates;

    function setRate(address tokenIn, address tokenOut, uint256 rateE18) external {
        rates[tokenIn][tokenOut] = rateE18;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        require(block.timestamp <= params.deadline, "Transaction too old");
        (address tokenIn,, address tokenOut) = SwapPath.decode(params.path);
        amountOut = params.amountIn * rates[tokenIn][tokenOut] / RATE_SCALE;
        require(amountOut >= params.amountOutMinimum, "Too little received");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(tokenOut).safeTransfer(params.recipient, amountOut);
    }
}
