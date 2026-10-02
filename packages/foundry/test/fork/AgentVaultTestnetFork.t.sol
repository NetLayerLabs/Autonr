// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentVault } from "../../contracts/AgentVault.sol";
import { IAgentVault } from "../../contracts/interfaces/IAgentVault.sol";
import { HederaForkTest } from "./HederaForkTest.sol";

/// @notice The guard against a real mispriced pool. The only liquid WHBAR/USDC pool on Hedera testnet prices HBAR about
///         20 times above Chainlink, so it overpays for WHBAR and underpays for USDC: the vault lets the first trade
///         through and refuses the second, because the minimum it passes to SaucerSwap comes from the oracles.
contract AgentVaultTestnetForkTest is HederaForkTest {
    NetworkConfig private config;
    AgentVault private vault;

    function setUp() public {
        config = _forkHedera("hedera_testnet");
        vault = _deployVault(config);
        deal(config.baseToken.token, address(vault), 100e8);
        deal(config.quoteToken.token, address(vault), 10e6);
    }

    function test_sellIntoTheMispricedPoolPassesTheGuard() public {
        IAgentVault.SwapRequest memory sell = _request(config.baseToken, config.quoteToken, config.poolFee, 10e8);
        IAgentVault.TradeReceipt memory receipt = _executeAndCheck(vault, sell, 1);

        uint256 fairOut = receipt.minAmountOut * 10_000 / (10_000 - vault.policy().maxSlippageBps);
        assertGt(receipt.amountOut, 5 * fairOut, "the pool overpays for WHBAR");
    }

    function test_buyFromTheMispricedPoolIsRefused() public {
        IAgentVault.SwapRequest memory buy = _request(config.quoteToken, config.baseToken, config.poolFee, 1e6);
        vm.prank(agent);
        vm.expectRevert(bytes("Too little received"));
        vault.executeSwap(buy, _reasoning(1));
        assertEq(vault.tradeCount(), 0);
    }
}
