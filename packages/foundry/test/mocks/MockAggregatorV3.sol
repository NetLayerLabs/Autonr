// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAggregatorV3 } from "../../contracts/interfaces/IAggregatorV3.sol";

/// @notice Chainlink feed whose decimals, answer and update time are set directly.
contract MockAggregatorV3 is IAggregatorV3 {
    uint8 public decimals;
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _roundId;

    constructor(uint8 decimals_, int256 answer) {
        decimals = decimals_;
        setAnswer(answer, block.timestamp);
    }

    function setDecimals(uint8 decimals_) external {
        decimals = decimals_;
    }

    function setAnswer(int256 answer, uint256 updatedAt) public {
        _answer = answer;
        _updatedAt = updatedAt;
        ++_roundId;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }
}
