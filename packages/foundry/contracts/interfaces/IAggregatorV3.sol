// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAggregatorV3
/// @notice The part of Chainlink's AggregatorV3Interface the vault reads (HBAR / USD on Hedera reports 8 decimals).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
