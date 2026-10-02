// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { AgentVault } from "../../contracts/AgentVault.sol";
import { IAgentVault } from "../../contracts/interfaces/IAgentVault.sol";
import { MockAggregatorV3 } from "../mocks/MockAggregatorV3.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockSupra } from "../mocks/MockSupra.sol";
import { MockSwapRouter } from "../mocks/MockSwapRouter.sol";

/// @notice A vault wired to mocks priced like vectors 1 and 2 of test/vectors/oracle-math.json: HBAR $0.10245 on
///         Chainlink and $0.10328 on Supra (81 bps apart), USDC $0.99997 on Supra. The router pays exactly the
///         oracle-fair amount, so vector amounts come out unchanged.
abstract contract AgentVaultFixture is Test {
    uint256 internal constant START = 1_790_000_000;
    uint8 internal constant WHBAR_DECIMALS = 8;
    uint8 internal constant USDC_DECIMALS = 6;
    uint32 internal constant SUPRA_HBAR_USDT = 75;
    uint32 internal constant SUPRA_USDC_USD = 89;
    uint24 internal constant POOL_FEE = 3000;
    uint64 internal constant TOPIC_NUM = 5_123_456;

    int256 internal constant CHAINLINK_HBAR_USD = 10_245_000; // 8 decimals
    uint256 internal constant SUPRA_HBAR_USDT_PRICE = 103_280_000_000_000_000; // 18 decimals
    uint256 internal constant SUPRA_USDC_USD_PRICE = 99_997_000; // 8 decimals
    uint256 internal constant HBAR_E18 = 102_450_000_000_000_000;
    uint256 internal constant USDC_E18 = 999_970_000_000_000_000;

    /// @dev Raw tokenOut per raw tokenIn (E18) that reproduces the vectors' expected outputs exactly.
    uint256 internal constant WHBAR_TO_USDC_RATE = 1_024_530 * 1e18 / 1e9;
    uint256 internal constant USDC_TO_WHBAR_RATE = 24_401_415_324 * 1e18 / 25e6;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal stranger = makeAddr("stranger");

    MockERC20 internal whbar;
    MockERC20 internal usdc;
    MockAggregatorV3 internal hbarUsd;
    MockSupra internal supra;
    MockSwapRouter internal router;
    AgentVault internal vault;

    function setUp() public virtual {
        vm.warp(START);
        whbar = new MockERC20("Wrapped HBAR", "WHBAR", WHBAR_DECIMALS);
        usdc = new MockERC20("USD Coin", "USDC", USDC_DECIMALS);
        hbarUsd = new MockAggregatorV3(8, CHAINLINK_HBAR_USD);
        supra = new MockSupra();
        _refreshOracles();

        router = new MockSwapRouter();
        router.setRate(address(whbar), address(usdc), WHBAR_TO_USDC_RATE);
        router.setRate(address(usdc), address(whbar), USDC_TO_WHBAR_RATE);
        whbar.mint(address(router), 1_000_000e8);
        usdc.mint(address(router), 1_000_000e6);

        vault = _deployVault(address(router), agent);
    }

    /// @dev A configured vault holding 10,000 WHBAR and 1,000 USDC.
    function _deployVault(address router_, address agent_) internal returns (AgentVault deployed) {
        deployed = new AgentVault(owner, router_, address(supra), agent_, TOPIC_NUM, _policy());
        vm.startPrank(owner);
        deployed.configureToken(address(whbar), address(hbarUsd), SUPRA_HBAR_USDT, true);
        deployed.configureToken(address(usdc), address(0), SUPRA_USDC_USD, true);
        deployed.setPoolFee(address(whbar), address(usdc), POOL_FEE);
        vm.stopPrank();
        whbar.mint(address(deployed), 10_000e8);
        usdc.mint(address(deployed), 1_000e6);
    }

    function _policy() internal pure returns (IAgentVault.Policy memory) {
        return IAgentVault.Policy({
            maxTradeUsd: 25e18,
            dailyCapUsd: 100e18,
            cooldown: 60,
            maxPriceAge: 7200,
            maxSlippageBps: 300,
            maxOracleDivergenceBps: 150
        });
    }

    function _setPolicy(IAgentVault.Policy memory newPolicy) internal {
        vm.prank(owner);
        vault.setPolicy(newPolicy);
    }

    /// @dev Supra reports milliseconds on Hedera, so the mock is fed milliseconds too.
    function _setSupra(uint32 pairId, uint256 decimals, uint256 price, uint256 timeSeconds) internal {
        supra.setSvalue(pairId, decimals, price, timeSeconds * 1000);
    }

    function _refreshOracles() internal {
        hbarUsd.setAnswer(CHAINLINK_HBAR_USD, block.timestamp);
        _setSupra(SUPRA_HBAR_USDT, 18, SUPRA_HBAR_USDT_PRICE, block.timestamp);
        _setSupra(SUPRA_USDC_USD, 8, SUPRA_USDC_USD_PRICE, block.timestamp);
    }

    function _sell(uint256 amountIn) internal view returns (IAgentVault.SwapRequest memory) {
        return IAgentVault.SwapRequest({
            tokenIn: address(whbar), tokenOut: address(usdc), poolFee: POOL_FEE, amountIn: amountIn
        });
    }

    function _buy(uint256 amountIn) internal view returns (IAgentVault.SwapRequest memory) {
        return IAgentVault.SwapRequest({
            tokenIn: address(usdc), tokenOut: address(whbar), poolFee: POOL_FEE, amountIn: amountIn
        });
    }

    function _reasoning(uint64 sequence) internal pure returns (IAgentVault.Reasoning memory) {
        return IAgentVault.Reasoning({ hash: keccak256(abi.encode("decision", sequence)), sequence: sequence });
    }

    function _execute(IAgentVault.SwapRequest memory request, uint64 sequence) internal returns (uint256) {
        vm.prank(agent);
        return vault.executeSwap(request, _reasoning(sequence));
    }

    function _expectExecuteRevert(IAgentVault.SwapRequest memory request, uint64 sequence, bytes memory reason)
        internal
    {
        IAgentVault.Reasoning memory reasoning = _reasoning(sequence);
        vm.prank(agent);
        vm.expectRevert(reason);
        vault.executeSwap(request, reasoning);
    }
}
