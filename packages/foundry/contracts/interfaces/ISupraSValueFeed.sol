// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISupraSValueFeed
/// @notice Supra's push oracle ("S-Value feed"). One contract serves every pair, addressed by pair index.
interface ISupraSValueFeed {
    /// @param round Supra round of the update.
    /// @param decimals Decimals of `price`; they differ per pair (HBAR_USDT 18, USDC_USD 8).
    /// @param time Update time. On Hedera this is unix MILLISECONDS.
    /// @param price The pair's price.
    struct PriceFeed {
        uint256 round;
        uint256 decimals;
        uint256 time;
        uint256 price;
    }

    function getSvalue(uint256 pairIndex) external view returns (PriceFeed memory);
}
