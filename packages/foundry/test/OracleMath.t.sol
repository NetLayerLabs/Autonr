// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { OracleMath } from "../contracts/libraries/OracleMath.sol";

/// @notice OracleMath against the vectors the agent's TypeScript math is tested with, plus properties that must hold
///         for any input.
contract OracleMathTest is Test {
    string private constant VECTORS = "test/vectors/oracle-math.json";
    uint256 private constant MAX_PRICE = 1e30;
    uint256 private constant MAX_AMOUNT = 1e30;

    function test_matchesSharedVectors() public view {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/", VECTORS));
        string[] memory names = abi.decode(vm.parseJson(json, "$[*].name"), (string[]));
        assertGt(names.length, 0, "no vectors");

        for (uint256 i = 0; i < names.length; ++i) {
            string memory at = string.concat("$[", vm.toString(i), "]");
            uint256 priceIn = _checkReading(json, string.concat(at, ".oracleIn"), names[i]);
            uint256 priceOut = _checkReading(json, string.concat(at, ".oracleOut"), names[i]);

            uint256 usd = OracleMath.usdValue(_uint(json, at, ".amountIn"), priceIn, _uint(json, at, ".decimalsIn"));
            assertEq(usd, _uint(json, at, ".expected.usdValue"), names[i]);

            uint256 expectedOut = OracleMath.expectedOut(usd, priceOut, _uint(json, at, ".decimalsOut"));
            assertEq(expectedOut, _uint(json, at, ".expected.expectedOut"), names[i]);

            uint256 minOut = OracleMath.minAmountOut(expectedOut, _uint(json, at, ".maxSlippageBps"));
            assertEq(minOut, _uint(json, at, ".expected.minAmountOut"), names[i]);
        }
    }

    function testFuzz_minAmountOutNeverExceedsExpectedOut(uint256 expectedOut, uint256 maxSlippageBps) public pure {
        maxSlippageBps = bound(maxSlippageBps, 0, OracleMath.BPS);
        uint256 minOut = OracleMath.minAmountOut(expectedOut, maxSlippageBps);
        assertLe(minOut, expectedOut);
        if (maxSlippageBps == 0) assertEq(minOut, expectedOut);
    }

    function testFuzz_normalizeIsMonotonic(uint256 a, uint256 b, uint256 decimals) public pure {
        decimals = bound(decimals, 0, 36);
        uint256 limit = decimals <= 18 ? type(uint256).max / 10 ** (18 - decimals) : type(uint256).max;
        a = bound(a, 0, limit);
        b = bound(b, a, limit);
        assertLe(OracleMath.normalize(a, decimals), OracleMath.normalize(b, decimals));
    }

    function testFuzz_normalizeIsLosslessUpTo18Decimals(uint256 value, uint256 decimals) public pure {
        decimals = bound(decimals, 0, 18);
        value = bound(value, 0, type(uint256).max / 10 ** (18 - decimals));
        assertEq(OracleMath.normalize(value, decimals) / 10 ** (18 - decimals), value);
    }

    /// @dev Flooring each part loses at most one unit compared with flooring the sum.
    function testFuzz_usdValueIsLinearUpToRounding(uint256 a, uint256 b, uint256 priceE18, uint256 decimals)
        public
        pure
    {
        a = bound(a, 0, MAX_AMOUNT);
        b = bound(b, 0, MAX_AMOUNT);
        priceE18 = bound(priceE18, 1, MAX_PRICE);
        decimals = bound(decimals, 0, 18);

        uint256 whole = OracleMath.usdValue(a + b, priceE18, decimals);
        uint256 parts = OracleMath.usdValue(a, priceE18, decimals) + OracleMath.usdValue(b, priceE18, decimals);
        assertGe(whole, parts);
        assertLe(whole, parts + 1);
    }

    /// @dev Rounding down means the oracle-fair output is never worth more than the input.
    function testFuzz_expectedOutNeverOverpays(uint256 usdValueE18, uint256 priceOutE18, uint256 decimalsOut)
        public
        pure
    {
        usdValueE18 = bound(usdValueE18, 0, MAX_AMOUNT);
        priceOutE18 = bound(priceOutE18, 1, MAX_PRICE);
        decimalsOut = bound(decimalsOut, 0, 18);

        uint256 out = OracleMath.expectedOut(usdValueE18, priceOutE18, decimalsOut);
        assertLe(OracleMath.usdValue(out, priceOutE18, decimalsOut), usdValueE18);
    }

    function testFuzz_divergenceIsZeroForEqualPrices(uint256 priceE18) public pure {
        priceE18 = bound(priceE18, 1, type(uint256).max);
        assertEq(OracleMath.divergenceBps(priceE18, priceE18), 0);
    }

    function testFuzz_divergenceDependsOnlyOnDistance(uint256 primaryE18, uint256 distance) public pure {
        primaryE18 = bound(primaryE18, 1, MAX_PRICE);
        distance = bound(distance, 0, primaryE18);
        assertEq(
            OracleMath.divergenceBps(primaryE18, primaryE18 + distance),
            OracleMath.divergenceBps(primaryE18, primaryE18 - distance)
        );
    }

    /// @return priceE18 The vector's primary price, normalized.
    function _checkReading(string memory json, string memory at, string memory name)
        private
        view
        returns (uint256 priceE18)
    {
        priceE18 = OracleMath.normalize(_uint(json, at, ".primary.value"), _uint(json, at, ".primary.decimals"));
        assertEq(priceE18, _uint(json, at, ".expected.priceE18"), name);

        uint256 crossCheckE18;
        uint256 divergence;
        if (vm.keyExistsJson(json, string.concat(at, ".crossCheck.value"))) {
            crossCheckE18 =
                OracleMath.normalize(_uint(json, at, ".crossCheck.value"), _uint(json, at, ".crossCheck.decimals"));
            divergence = OracleMath.divergenceBps(priceE18, crossCheckE18);
        }
        assertEq(crossCheckE18, _uint(json, at, ".expected.crossCheckE18"), name);
        assertEq(divergence, _uint(json, at, ".expected.divergenceBps"), name);
    }

    function _uint(string memory json, string memory at, string memory key) private pure returns (uint256) {
        return vm.parseJsonUint(json, string.concat(at, key));
    }
}
