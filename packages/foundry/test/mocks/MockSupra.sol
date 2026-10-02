// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ISupraSValueFeed } from "../../contracts/interfaces/ISupraSValueFeed.sol";

/// @notice Supra push oracle whose per-pair feeds are set directly. Unknown pairs read as all zeros, like Supra's.
contract MockSupra is ISupraSValueFeed {
    mapping(uint256 pairIndex => PriceFeed feed) private _feeds;

    /// @param time Update time in the unit Supra uses on Hedera: milliseconds.
    function setSvalue(uint256 pairIndex, uint256 decimals, uint256 price, uint256 time) external {
        _feeds[pairIndex] =
            PriceFeed({ round: _feeds[pairIndex].round + 1, decimals: decimals, time: time, price: price });
    }

    function getSvalue(uint256 pairIndex) external view returns (PriceFeed memory) {
        return _feeds[pairIndex];
    }
}
