// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { HelperConfig } from "../script/HelperConfig.s.sol";

/// @notice The deploy script and the agent each carry the Hedera addresses. This fails when one side changes an
///         address or the default pool fee and the other does not.
contract HelperConfigTest is Test, HelperConfig {
    string private constant AGENT_NETWORKS = "../agent/src/networks.ts";

    function test_hederaConfigMatchesTheAgentNetworks() public view {
        string memory networks = vm.toLowercase(vm.readFile(AGENT_NETWORKS));
        _assertListed(networks, _hederaTestnet());
        _assertListed(networks, _hederaMainnet());
    }

    function _assertListed(string memory networks, NetworkConfig memory config) private pure {
        address[5] memory addresses = [
            config.router, config.supra, config.baseToken.token, config.baseToken.chainlinkFeed, config.quoteToken.token
        ];
        for (uint256 i = 0; i < addresses.length; ++i) {
            string memory addr = vm.toLowercase(vm.toString(addresses[i]));
            assertTrue(vm.contains(networks, addr), string.concat(addr, " is missing from ", AGENT_NETWORKS));
        }
        string memory poolFee = string.concat("defaultpoolfee: ", vm.toString(config.poolFee));
        assertTrue(vm.contains(networks, poolFee), string.concat(poolFee, " is missing from ", AGENT_NETWORKS));
    }
}
