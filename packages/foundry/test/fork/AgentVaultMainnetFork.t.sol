// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentVault } from "../../contracts/AgentVault.sol";
import { IAgentVault } from "../../contracts/interfaces/IAgentVault.sol";
import { HederaForkTest } from "./HederaForkTest.sol";

/// @notice End to end on a Hedera mainnet fork: real Chainlink HBAR / USD, real Supra, real SaucerSwap V2 pool.
contract AgentVaultMainnetForkTest is HederaForkTest {
    NetworkConfig private config;
    AgentVault private vault;

    function setUp() public {
        config = _forkHedera("hedera_mainnet");
        vault = _deployVault(config);
        deal(config.baseToken.token, address(vault), 100e8);
    }

    function test_sellsWhbarForUsdcAtTheOracleDerivedMinimum() public {
        IAgentVault.SwapRequest memory sell = _request(config.baseToken, config.quoteToken, config.poolFee, 20e8);
        IAgentVault.TradeReceipt memory receipt = _executeAndCheck(vault, sell, 1);

        // Mainnet pools track the market, so the fill lands within the policy's 3% of the oracle-fair amount.
        assertGt(receipt.oracleIn.crossCheckE18, 0, "WHBAR must be cross-checked by Supra");
        assertLe(receipt.oracleIn.divergenceBps, vault.policy().maxOracleDivergenceBps);
        assertEq(receipt.oracleOut.crossCheckE18, 0, "USDC is priced by Supra alone");
        assertEq(vault.tradeCount(), 1);
    }
}
