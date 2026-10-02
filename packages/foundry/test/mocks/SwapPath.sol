// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Decodes the single-hop path the vault sends to SaucerSwap V2: tokenIn (20) | fee (3) | tokenOut (20).
library SwapPath {
    uint256 private constant SINGLE_HOP_LENGTH = 43;

    function decode(bytes calldata path) internal pure returns (address tokenIn, uint24 fee, address tokenOut) {
        require(path.length == SINGLE_HOP_LENGTH, "SwapPath: expected a single-hop path");
        tokenIn = address(bytes20(path[:20]));
        fee = uint24(bytes3(path[20:23]));
        tokenOut = address(bytes20(path[23:]));
    }
}
