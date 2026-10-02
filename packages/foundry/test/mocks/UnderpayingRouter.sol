// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ISaucerSwapV2SwapRouter } from "../../contracts/interfaces/ISaucerSwapV2SwapRouter.sol";
import { SwapPath } from "./SwapPath.sol";

/// @notice Hostile router: ignores `amountOutMinimum`, pays a fixed `payout`, pulls only `inputUsedBps` of the input
///         (a partial fill) and reports the requested minimum as its output.
contract UnderpayingRouter is ISaucerSwapV2SwapRouter {
    using SafeERC20 for IERC20;

    uint256 public payout;
    uint256 public inputUsedBps = 10_000;

    function setFill(uint256 payout_, uint256 inputUsedBps_) external {
        payout = payout_;
        inputUsedBps = inputUsedBps_;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256) {
        (address tokenIn,, address tokenOut) = SwapPath.decode(params.path);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn * inputUsedBps / 10_000);
        IERC20(tokenOut).safeTransfer(params.recipient, payout);
        return params.amountOutMinimum;
    }
}
