// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title OracleMath
/// @notice Fixed-point arithmetic that turns oracle prices into swap bounds.
/// @dev Prices and USD values are unsigned 18-decimal fixed point ("E18"); token amounts are raw smallest units.
///      Every function rounds down. The agent mirrors these functions in TypeScript to predict the vault exactly, and
///      both implementations are tested against test/vectors/oracle-math.json, so change them together or not at all.
library OracleMath {
    /// @notice One hundred percent in basis points.
    uint256 internal constant BPS = 10_000;

    uint256 private constant E18_DECIMALS = 18;

    /// @notice Rescales `value`, expressed with `decimals` decimals, to 18 decimals.
    /// @dev Feeds with more than 18 decimals lose their extra precision.
    function normalize(uint256 value, uint256 decimals) internal pure returns (uint256) {
        if (decimals <= E18_DECIMALS) return value * 10 ** (E18_DECIMALS - decimals);
        return value / 10 ** (decimals - E18_DECIMALS);
    }

    /// @notice How far `crossCheckE18` is from `primaryE18`, in basis points of `primaryE18`.
    /// @dev `primaryE18` must be non-zero.
    function divergenceBps(uint256 primaryE18, uint256 crossCheckE18) internal pure returns (uint256) {
        uint256 difference = primaryE18 > crossCheckE18 ? primaryE18 - crossCheckE18 : crossCheckE18 - primaryE18;
        return Math.mulDiv(difference, BPS, primaryE18);
    }

    /// @notice USD value (E18) of `amountIn` raw units of a token with `decimalsIn` decimals priced at `priceInE18`.
    function usdValue(uint256 amountIn, uint256 priceInE18, uint256 decimalsIn) internal pure returns (uint256) {
        return Math.mulDiv(amountIn, priceInE18, 10 ** decimalsIn);
    }

    /// @notice Raw amount of a token with `decimalsOut` decimals priced at `priceOutE18` that is worth `usdValueE18`.
    /// @dev `priceOutE18` must be non-zero.
    function expectedOut(uint256 usdValueE18, uint256 priceOutE18, uint256 decimalsOut)
        internal
        pure
        returns (uint256)
    {
        return Math.mulDiv(usdValueE18, 10 ** decimalsOut, priceOutE18);
    }

    /// @notice The lowest output the vault accepts: `expectedAmountOut` reduced by `maxSlippageBps`.
    /// @dev `maxSlippageBps` must not exceed `BPS`.
    function minAmountOut(uint256 expectedAmountOut, uint256 maxSlippageBps) internal pure returns (uint256) {
        return Math.mulDiv(expectedAmountOut, BPS - maxSlippageBps, BPS);
    }
}
