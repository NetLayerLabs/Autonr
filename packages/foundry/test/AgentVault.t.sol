// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Vm } from "forge-std/Vm.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { AgentVault } from "../contracts/AgentVault.sol";
import { IAgentVault } from "../contracts/interfaces/IAgentVault.sol";
import { IHederaTokenService } from "../contracts/interfaces/IHederaTokenService.sol";
import { ISaucerSwapV2SwapRouter } from "../contracts/interfaces/ISaucerSwapV2SwapRouter.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockHederaTokenService } from "./mocks/MockHederaTokenService.sol";
import { ReentrantRouter } from "./mocks/ReentrantRouter.sol";
import { UnderpayingRouter } from "./mocks/UnderpayingRouter.sol";
import { AgentVaultFixture } from "./utils/AgentVaultFixture.sol";

contract AgentVaultTest is AgentVaultFixture {
    address private constant HTS = address(0x167);
    int64 private constant HTS_SUCCESS = 22;
    int64 private constant HTS_TOKEN_ALREADY_ASSOCIATED = 194;
    int64 private constant HTS_INVALID_TOKEN_ID = 167;
    int64 private constant HTS_UNKNOWN = 21;

    // Vector 1: sell 10 WHBAR, 3% slippage.
    uint256 private constant SELL_AMOUNT = 1_000_000_000;
    uint256 private constant SELL_USD = 1_024_500_000_000_000_000;
    uint256 private constant SELL_EXPECTED_OUT = 1_024_530;
    uint256 private constant SELL_MIN_OUT = 993_794;
    uint256 private constant HBAR_DIVERGENCE_BPS = 81;

    // Vector 2: buy WHBAR with 25 USDC, 1% slippage.
    uint256 private constant BUY_AMOUNT = 25_000_000;
    uint256 private constant BUY_USD = 24_999_250_000_000_000_000;
    uint256 private constant BUY_EXPECTED_OUT = 24_401_415_324;
    uint256 private constant BUY_MIN_OUT = 24_157_401_170;

    // ---------------------------------------------------------------- constructor

    function test_constructor_setsStateAndEmitsSetterEvents() public {
        vm.expectEmit(true, true, false, false);
        emit IAgentVault.AgentUpdated(address(0), agent);
        vm.expectEmit(false, false, false, true);
        emit IAgentVault.DecisionTopicUpdated(0, TOPIC_NUM);
        vm.expectEmit(false, false, false, true);
        emit IAgentVault.PolicyUpdated(_policy());
        AgentVault fresh = new AgentVault(owner, address(router), address(supra), agent, TOPIC_NUM, _policy());

        assertEq(fresh.owner(), owner);
        assertEq(fresh.agent(), agent);
        assertEq(address(fresh.ROUTER()), address(router));
        assertEq(address(fresh.SUPRA()), address(supra));
        assertEq(fresh.hcsTopicNum(), TOPIC_NUM);
        assertEq(abi.encode(fresh.policy()), abi.encode(_policy()));
        assertEq(fresh.allowedTokens().length, 0);
        assertFalse(fresh.paused());
    }

    function test_constructor_acceptsMissingDecisionTopic() public {
        AgentVault fresh = new AgentVault(owner, address(router), address(supra), agent, 0, _policy());
        assertEq(fresh.hcsTopicNum(), 0);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new AgentVault(address(0), address(router), address(supra), agent, TOPIC_NUM, _policy());
    }

    function test_constructor_revertsOnZeroRouter() public {
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        new AgentVault(owner, address(0), address(supra), agent, TOPIC_NUM, _policy());
    }

    function test_constructor_revertsOnZeroSupra() public {
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        new AgentVault(owner, address(router), address(0), agent, TOPIC_NUM, _policy());
    }

    function test_constructor_revertsOnZeroAgent() public {
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        new AgentVault(owner, address(router), address(supra), address(0), TOPIC_NUM, _policy());
    }

    function test_constructor_revertsOnInvalidPolicy() public {
        IAgentVault.Policy memory invalid = _policy();
        invalid.maxTradeUsd = 0;
        vm.expectRevert(IAgentVault.InvalidPolicy.selector);
        new AgentVault(owner, address(router), address(supra), agent, TOPIC_NUM, invalid);
    }

    // ---------------------------------------------------------------- access control

    function test_ownerFunctions_revertForAgentAndStrangers() public {
        bytes[] memory calls = new bytes[](11);
        calls[0] = abi.encodeCall(AgentVault.setAgent, (stranger));
        calls[1] = abi.encodeCall(AgentVault.setPolicy, (_policy()));
        calls[2] = abi.encodeCall(AgentVault.setDecisionTopic, (1));
        calls[3] = abi.encodeCall(AgentVault.configureToken, (address(whbar), address(hbarUsd), 75, true));
        calls[4] = abi.encodeCall(AgentVault.removeToken, (address(whbar)));
        calls[5] = abi.encodeCall(AgentVault.associateToken, (address(whbar)));
        calls[6] = abi.encodeCall(AgentVault.pause, ());
        calls[7] = abi.encodeCall(AgentVault.unpause, ());
        calls[8] = abi.encodeCall(AgentVault.withdraw, (address(whbar), 1, stranger));
        calls[9] = abi.encodeCall(Ownable.transferOwnership, (stranger));
        calls[10] = abi.encodeCall(AgentVault.setPoolFee, (address(whbar), address(usdc), 1500));

        address[2] memory callers = [agent, stranger];
        for (uint256 c = 0; c < callers.length; ++c) {
            for (uint256 i = 0; i < calls.length; ++i) {
                vm.prank(callers[c]);
                (bool success, bytes memory revertData) = address(vault).call(calls[i]);
                assertFalse(success, "owner-only call succeeded");
                assertEq(revertData, abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, callers[c]));
            }
        }
    }

    function test_renounceOwnership_isDisabled() public {
        vm.prank(owner);
        vm.expectRevert(IAgentVault.OwnershipCannotBeRenounced.selector);
        vault.renounceOwnership();
        assertEq(vault.owner(), owner);
    }

    function test_transferOwnership_takesTwoSteps() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        vault.transferOwnership(newOwner);
        assertEq(vault.owner(), owner);
        assertEq(vault.pendingOwner(), newOwner);

        vm.prank(newOwner);
        vault.acceptOwnership();
        assertEq(vault.owner(), newOwner);
    }

    // ---------------------------------------------------------------- setAgent

    function test_setAgent_movesTradingRightsToTheNewAgent() public {
        address newAgent = makeAddr("newAgent");
        vm.expectEmit(true, true, false, false, address(vault));
        emit IAgentVault.AgentUpdated(agent, newAgent);
        vm.prank(owner);
        vault.setAgent(newAgent);
        assertEq(vault.agent(), newAgent);

        _expectExecuteRevert(_sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.NotAgent.selector, agent));
        vm.prank(newAgent);
        vault.executeSwap(_sell(SELL_AMOUNT), _reasoning(1));
    }

    function test_setAgent_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        vault.setAgent(address(0));
    }

    // ---------------------------------------------------------------- setPolicy

    function test_setPolicy_storesAndEmits() public {
        IAgentVault.Policy memory updated = IAgentVault.Policy({
            maxTradeUsd: 10e18,
            dailyCapUsd: 40e18,
            cooldown: 0,
            maxPriceAge: 600,
            maxSlippageBps: 50,
            maxOracleDivergenceBps: 75
        });
        vm.expectEmit(false, false, false, true, address(vault));
        emit IAgentVault.PolicyUpdated(updated);
        _setPolicy(updated);
        assertEq(abi.encode(vault.policy()), abi.encode(updated));
    }

    function test_setPolicy_rejectsEveryOutOfRangeField() public {
        IAgentVault.Policy[] memory invalid = new IAgentVault.Policy[](9);
        for (uint256 i = 0; i < invalid.length; ++i) {
            invalid[i] = _policy();
        }
        invalid[0].maxTradeUsd = 0;
        invalid[1].dailyCapUsd = invalid[1].maxTradeUsd - 1;
        invalid[2].maxPriceAge = 59;
        invalid[3].maxPriceAge = 86_401;
        invalid[4].maxSlippageBps = 0;
        invalid[5].maxSlippageBps = 5001;
        invalid[6].maxOracleDivergenceBps = 0;
        invalid[7].maxOracleDivergenceBps = 5001;
        invalid[8].dailyCapUsd = 0;

        for (uint256 i = 0; i < invalid.length; ++i) {
            vm.prank(owner);
            vm.expectRevert(IAgentVault.InvalidPolicy.selector);
            vault.setPolicy(invalid[i]);
        }
    }

    function test_setPolicy_acceptsBoundaryValues() public {
        _setPolicy(
            IAgentVault.Policy({
                maxTradeUsd: 1,
                dailyCapUsd: 1,
                cooldown: 0,
                maxPriceAge: 60,
                maxSlippageBps: 1,
                maxOracleDivergenceBps: 1
            })
        );
        _setPolicy(
            IAgentVault.Policy({
                maxTradeUsd: type(uint256).max,
                dailyCapUsd: type(uint256).max,
                cooldown: type(uint32).max,
                maxPriceAge: 86_400,
                maxSlippageBps: 5000,
                maxOracleDivergenceBps: 5000
            })
        );
        assertEq(vault.policy().maxPriceAge, 86_400);
    }

    // ---------------------------------------------------------------- setDecisionTopic

    function test_setDecisionTopic_storesAndEmits() public {
        vm.expectEmit(false, false, false, true, address(vault));
        emit IAgentVault.DecisionTopicUpdated(TOPIC_NUM, 777);
        vm.prank(owner);
        vault.setDecisionTopic(777);
        assertEq(vault.hcsTopicNum(), 777);
    }

    function test_setDecisionTopic_zeroDisablesTrading() public {
        vm.prank(owner);
        vault.setDecisionTopic(0);
        _expectExecuteRevert(_sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.DecisionTopicNotSet.selector));
    }

    function test_reasoningSequence_isTrackedPerTopic() public {
        _execute(_sell(SELL_AMOUNT), 40);
        assertEq(vault.lastReasoningSequence(), 40);

        vm.prank(owner);
        vault.setDecisionTopic(TOPIC_NUM + 1);
        assertEq(vault.lastReasoningSequence(), 0, "a new topic starts from zero");
        vm.warp(block.timestamp + 60);
        _execute(_sell(SELL_AMOUNT), 1);

        vm.prank(owner);
        vault.setDecisionTopic(TOPIC_NUM);
        assertEq(vault.lastReasoningSequence(), 40, "switching back restores the old topic's position");
        vm.warp(block.timestamp + 60);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 40, abi.encodeWithSelector(IAgentVault.ReasoningOutOfOrder.selector, 40, 40)
        );
    }

    // ---------------------------------------------------------------- configureToken / removeToken

    function test_configureToken_readsDecimalsAndEmits() public {
        MockERC20 token = new MockERC20("Token", "TKN", 12);
        vm.expectEmit(true, true, false, true, address(vault));
        emit IAgentVault.TokenConfigured(address(token), address(hbarUsd), 48, false, 12);
        vm.prank(owner);
        vault.configureToken(address(token), address(hbarUsd), 48, false);

        IAgentVault.TokenConfig memory config = vault.tokenConfig(address(token));
        assertTrue(config.allowed);
        assertEq(config.decimals, 12);
        assertEq(config.chainlinkFeed, address(hbarUsd));
        assertEq(config.supraPairId, 48);
        assertFalse(config.supraEnabled);
    }

    function test_configureToken_updatesInPlaceWithoutDuplicates() public {
        vm.prank(owner);
        vault.configureToken(address(whbar), address(0), SUPRA_HBAR_USDT, true);

        address[] memory tokens = vault.allowedTokens();
        assertEq(tokens.length, 2);
        assertEq(tokens[0], address(whbar));
        assertEq(tokens[1], address(usdc));
        assertEq(vault.tokenConfig(address(whbar)).chainlinkFeed, address(0));
    }

    function test_configureToken_revertsOnZeroToken() public {
        vm.prank(owner);
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        vault.configureToken(address(0), address(hbarUsd), 75, true);
    }

    function test_configureToken_revertsWithoutPriceSource() public {
        vm.prank(owner);
        vm.expectRevert(IAgentVault.NoPriceSource.selector);
        vault.configureToken(address(whbar), address(0), 75, false);
    }

    function test_configureToken_revertsAbove18Decimals() public {
        MockERC20 token = new MockERC20("Token", "TKN", 19);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.UnsupportedDecimals.selector, 19));
        vault.configureToken(address(token), address(hbarUsd), 75, true);
    }

    function test_removeToken_keepsConfigurationOrder() public {
        MockERC20 third = new MockERC20("Third", "THR", 18);
        vm.startPrank(owner);
        vault.configureToken(address(third), address(0), 48, true);

        vm.expectEmit(true, false, false, false, address(vault));
        emit IAgentVault.TokenRemoved(address(whbar));
        vault.removeToken(address(whbar));
        vm.stopPrank();

        address[] memory tokens = vault.allowedTokens();
        assertEq(tokens.length, 2);
        assertEq(tokens[0], address(usdc));
        assertEq(tokens[1], address(third));
        assertEq(
            abi.encode(vault.tokenConfig(address(whbar))),
            abi.encode(IAgentVault.TokenConfig(false, 0, address(0), 0, false))
        );
    }

    function test_removeToken_thenConfigureAppendsAgain() public {
        vm.startPrank(owner);
        vault.removeToken(address(whbar));
        vault.configureToken(address(whbar), address(hbarUsd), SUPRA_HBAR_USDT, true);
        vm.stopPrank();

        address[] memory tokens = vault.allowedTokens();
        assertEq(tokens.length, 2);
        assertEq(tokens[0], address(usdc));
        assertEq(tokens[1], address(whbar));
    }

    function test_removeToken_revertsForUnknownToken() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.TokenNotAllowed.selector, stranger));
        vault.removeToken(stranger);
    }

    // ---------------------------------------------------------------- setPoolFee

    function test_setPoolFee_appliesToBothDirectionsAndEmits() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit IAgentVault.PoolFeeSet(address(usdc), address(whbar), 1500);
        vm.prank(owner);
        vault.setPoolFee(address(usdc), address(whbar), 1500);

        assertEq(vault.poolFee(address(whbar), address(usdc)), 1500);
        assertEq(vault.poolFee(address(usdc), address(whbar)), 1500);
        IAgentVault.SwapRequest memory request = _sell(SELL_AMOUNT);
        request.poolFee = 1500;
        _execute(request, 1);
    }

    function test_setPoolFee_zeroDisallowsThePair() public {
        vm.prank(owner);
        vault.setPoolFee(address(whbar), address(usdc), 0);
        assertEq(vault.poolFee(address(usdc), address(whbar)), 0);
        _expectExecuteRevert(_buy(BUY_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.PoolFeeNotAllowed.selector, 3000));
    }

    function test_setPoolFee_revertsOnZeroTokenOrSamePair() public {
        vm.startPrank(owner);
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        vault.setPoolFee(address(0), address(usdc), 3000);
        vm.expectRevert(IAgentVault.InvalidPair.selector);
        vault.setPoolFee(address(usdc), address(usdc), 3000);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- associateToken

    function test_associateToken_associatesTheVaultItself() public {
        _installHts(HTS_SUCCESS);
        vm.expectCall(HTS, abi.encodeCall(IHederaTokenService.associateToken, (address(vault), address(whbar))));
        vm.expectEmit(true, false, false, false, address(vault));
        emit IAgentVault.TokenAssociated(address(whbar));
        vm.prank(owner);
        vault.associateToken(address(whbar));
    }

    function test_associateToken_treatsExistingAssociationAsSuccess() public {
        _installHts(HTS_TOKEN_ALREADY_ASSOCIATED);
        vm.expectEmit(true, false, false, false, address(vault));
        emit IAgentVault.TokenAssociated(address(whbar));
        vm.prank(owner);
        vault.associateToken(address(whbar));
    }

    function test_associateToken_revertsWithTheHtsResponseCode() public {
        _installHts(HTS_INVALID_TOKEN_ID);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IAgentVault.HtsAssociationFailed.selector, address(whbar), HTS_INVALID_TOKEN_ID)
        );
        vault.associateToken(address(whbar));
    }

    function test_associateToken_reportsUnknownWithoutTheSystemContract() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.HtsAssociationFailed.selector, address(whbar), HTS_UNKNOWN));
        vault.associateToken(address(whbar));
    }

    function test_associateToken_reportsUnknownWhenTheSystemContractReverts() public {
        _installHts(HTS_SUCCESS);
        vm.mockCallRevert(HTS, abi.encodeWithSelector(IHederaTokenService.associateToken.selector), "");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.HtsAssociationFailed.selector, address(whbar), HTS_UNKNOWN));
        vault.associateToken(address(whbar));
    }

    // ---------------------------------------------------------------- pause / withdraw

    function test_pause_blocksTradingButNotWithdrawals() public {
        vm.prank(owner);
        vault.pause();
        _expectExecuteRevert(_sell(SELL_AMOUNT), 1, abi.encodeWithSelector(Pausable.EnforcedPause.selector));

        address treasury = makeAddr("treasury");
        vm.prank(owner);
        vault.withdraw(address(usdc), 100e6, treasury);
        assertEq(usdc.balanceOf(treasury), 100e6);

        vm.prank(owner);
        vault.unpause();
        _execute(_sell(SELL_AMOUNT), 1);
    }

    function test_withdraw_sendsTokensAndEmits() public {
        address treasury = makeAddr("treasury");
        uint256 vaultBalance = whbar.balanceOf(address(vault));
        vm.expectEmit(true, true, false, true, address(vault));
        emit IAgentVault.Withdrawn(address(whbar), treasury, 5e8);
        vm.prank(owner);
        vault.withdraw(address(whbar), 5e8, treasury);

        assertEq(whbar.balanceOf(treasury), 5e8);
        assertEq(whbar.balanceOf(address(vault)), vaultBalance - 5e8);
    }

    function test_withdraw_revertsOnZeroRecipient() public {
        vm.prank(owner);
        vm.expectRevert(IAgentVault.ZeroAddress.selector);
        vault.withdraw(address(whbar), 1, address(0));
    }

    function test_withdraw_revertsOnZeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(IAgentVault.ZeroAmount.selector);
        vault.withdraw(address(whbar), 0, owner);
    }

    // ---------------------------------------------------------------- executeSwap: successful trades

    function test_executeSwap_sellsAtTheOracleDerivedMinimum() public {
        vm.expectCall(
            address(router),
            abi.encodeCall(
                ISaucerSwapV2SwapRouter.exactInput,
                (ISaucerSwapV2SwapRouter.ExactInputParams({
                        path: abi.encodePacked(address(whbar), POOL_FEE, address(usdc)),
                        recipient: address(vault),
                        deadline: block.timestamp,
                        amountIn: SELL_AMOUNT,
                        amountOutMinimum: SELL_MIN_OUT
                    }))
            )
        );
        vm.expectEmit(true, true, true, true, address(vault));
        emit IAgentVault.TradeExecuted(
            1,
            address(whbar),
            address(usdc),
            IAgentVault.TradeReceipt({
                amountIn: SELL_AMOUNT,
                amountOut: SELL_EXPECTED_OUT,
                minAmountOut: SELL_MIN_OUT,
                usdValue: SELL_USD,
                oracleIn: IAgentVault.OracleReading(HBAR_E18, START, SUPRA_HBAR_USDT_PRICE, START, HBAR_DIVERGENCE_BPS),
                oracleOut: IAgentVault.OracleReading(USDC_E18, START, 0, 0, 0),
                reasoningHash: _reasoning(1).hash,
                hcsTopicNum: TOPIC_NUM,
                hcsSequence: 1
            })
        );
        uint256 whbarBefore = whbar.balanceOf(address(vault));
        uint256 usdcBefore = usdc.balanceOf(address(vault));

        uint256 amountOut = _execute(_sell(SELL_AMOUNT), 1);

        assertEq(amountOut, SELL_EXPECTED_OUT);
        assertEq(whbar.balanceOf(address(vault)), whbarBefore - SELL_AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), usdcBefore + SELL_EXPECTED_OUT);
        assertEq(vault.tradeCount(), 1);
        assertEq(vault.lastTradeAt(), START);
        assertEq(vault.lastReasoningSequence(), 1);
        assertEq(vault.spentUsdOn(START / 1 days), SELL_USD);
        assertEq(vault.nextTradeAt(), START + 60);
        assertEq(vault.remainingDailyUsd(), 100e18 - SELL_USD);
    }

    function test_executeSwap_buysAtTheOracleDerivedMinimum() public {
        IAgentVault.Policy memory tighter = _policy();
        tighter.maxSlippageBps = 100;
        _setPolicy(tighter);

        vm.expectEmit(true, true, true, true, address(vault));
        emit IAgentVault.TradeExecuted(
            1,
            address(usdc),
            address(whbar),
            IAgentVault.TradeReceipt({
                amountIn: BUY_AMOUNT,
                amountOut: BUY_EXPECTED_OUT,
                minAmountOut: BUY_MIN_OUT,
                usdValue: BUY_USD,
                oracleIn: IAgentVault.OracleReading(USDC_E18, START, 0, 0, 0),
                oracleOut: IAgentVault.OracleReading(
                    HBAR_E18, START, SUPRA_HBAR_USDT_PRICE, START, HBAR_DIVERGENCE_BPS
                ),
                reasoningHash: _reasoning(9).hash,
                hcsTopicNum: TOPIC_NUM,
                hcsSequence: 9
            })
        );
        assertEq(_execute(_buy(BUY_AMOUNT), 9), BUY_EXPECTED_OUT);
    }

    function test_executeSwap_acceptsOutputExactlyAtTheMinimum() public {
        router.setRate(address(whbar), address(usdc), SELL_MIN_OUT * 1e18 / SELL_AMOUNT);
        assertEq(_execute(_sell(SELL_AMOUNT), 1), SELL_MIN_OUT);
    }

    function test_executeSwap_tradesExactlyWhatQuoteAndOracleReadingReport() public {
        vm.warp(START + 1000);
        hbarUsd.setAnswer(10_300_000, START + 900);
        _setSupra(SUPRA_HBAR_USDT, 18, 0.1031e18, START + 990);
        _setSupra(SUPRA_USDC_USD, 8, 1.0001e8, START + 500);

        IAgentVault.Quote memory quoted = vault.quote(_sell(SELL_AMOUNT));
        assertEq(abi.encode(vault.oracleReading(address(whbar))), abi.encode(quoted.tokenIn));
        assertEq(abi.encode(vault.oracleReading(address(usdc))), abi.encode(quoted.tokenOut));

        vm.expectEmit(true, true, true, true, address(vault));
        emit IAgentVault.TradeExecuted(
            1,
            address(whbar),
            address(usdc),
            IAgentVault.TradeReceipt({
                amountIn: SELL_AMOUNT,
                amountOut: SELL_AMOUNT * WHBAR_TO_USDC_RATE / 1e18,
                minAmountOut: quoted.minAmountOut,
                usdValue: quoted.usdValue,
                oracleIn: quoted.tokenIn,
                oracleOut: quoted.tokenOut,
                reasoningHash: _reasoning(1).hash,
                hcsTopicNum: TOPIC_NUM,
                hcsSequence: 1
            })
        );
        _execute(_sell(SELL_AMOUNT), 1);
    }

    function test_executeSwap_leavesNoRouterAllowance() public {
        _execute(_sell(SELL_AMOUNT), 1);
        assertEq(whbar.allowance(address(vault), address(router)), 0);
    }

    function test_executeSwap_clearsAllowanceLeftByAPartialFill() public {
        UnderpayingRouter partialRouter = new UnderpayingRouter();
        usdc.mint(address(partialRouter), 1_000e6);
        partialRouter.setFill(SELL_EXPECTED_OUT, 5000);
        vault = _deployVault(address(partialRouter), agent);
        uint256 whbarBefore = whbar.balanceOf(address(vault));

        _execute(_sell(SELL_AMOUNT), 1);

        assertEq(whbar.balanceOf(address(vault)), whbarBefore - SELL_AMOUNT / 2);
        assertEq(whbar.allowance(address(vault), address(partialRouter)), 0);
    }

    function test_executeSwap_reportsAndCountsOnlyWhatAPartialFillSpent() public {
        UnderpayingRouter partialRouter = new UnderpayingRouter();
        usdc.mint(address(partialRouter), 1_000e6);
        partialRouter.setFill(SELL_EXPECTED_OUT, 5000);
        vault = _deployVault(address(partialRouter), agent);
        uint256 halfUsd = vault.quote(_sell(SELL_AMOUNT / 2)).usdValue;

        vm.recordLogs();
        _execute(_sell(SELL_AMOUNT), 1);

        assertEq(vault.spentUsdOn(START / 1 days), halfUsd);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        IAgentVault.TradeReceipt memory receipt = abi.decode(logs[logs.length - 1].data, (IAgentVault.TradeReceipt));
        assertEq(logs[logs.length - 1].topics[0], IAgentVault.TradeExecuted.selector);
        assertEq(receipt.amountIn, SELL_AMOUNT / 2);
        assertEq(receipt.usdValue, halfUsd);
        assertEq(receipt.minAmountOut, SELL_MIN_OUT);
    }

    function testFuzz_executeSwap_neverAcceptsLessThanTheMinimum(uint256 rate) public {
        rate = bound(rate, 0, 2 * WHBAR_TO_USDC_RATE);
        router.setRate(address(whbar), address(usdc), rate);
        uint256 payout = SELL_AMOUNT * rate / 1e18;

        if (payout < SELL_MIN_OUT) {
            _expectExecuteRevert(_sell(SELL_AMOUNT), 1, bytes("Too little received"));
        } else {
            assertEq(_execute(_sell(SELL_AMOUNT), 1), payout);
        }
    }

    // ---------------------------------------------------------------- executeSwap: refusals in check order

    function test_executeSwap_revertsForNonAgent() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.NotAgent.selector, stranger));
        vault.executeSwap(_sell(SELL_AMOUNT), _reasoning(1));
    }

    function test_executeSwap_checksCallerBeforePause() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.NotAgent.selector, stranger));
        vault.executeSwap(_sell(SELL_AMOUNT), _reasoning(1));
    }

    function test_executeSwap_checksPauseBeforeReasoning() public {
        vm.prank(owner);
        vault.pause();
        IAgentVault.Reasoning memory missing = IAgentVault.Reasoning({ hash: bytes32(0), sequence: 1 });
        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.executeSwap(_sell(SELL_AMOUNT), missing);
    }

    function test_executeSwap_revertsWithoutReasoningHash_beforeTopicCheck() public {
        vm.prank(owner);
        vault.setDecisionTopic(0);
        IAgentVault.Reasoning memory missing = IAgentVault.Reasoning({ hash: bytes32(0), sequence: 1 });
        vm.prank(agent);
        vm.expectRevert(IAgentVault.ReasoningRequired.selector);
        vault.executeSwap(_sell(SELL_AMOUNT), missing);
    }

    function test_executeSwap_checksTopicBeforeSequence() public {
        vm.prank(owner);
        vault.setDecisionTopic(0);
        _expectExecuteRevert(_sell(SELL_AMOUNT), 0, abi.encodeWithSelector(IAgentVault.DecisionTopicNotSet.selector));
    }

    function test_executeSwap_requiresStrictlyIncreasingSequences() public {
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 0, abi.encodeWithSelector(IAgentVault.ReasoningOutOfOrder.selector, 0, 0)
        );
        _execute(_sell(SELL_AMOUNT), 7);
        vm.warp(block.timestamp + 60);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 7, abi.encodeWithSelector(IAgentVault.ReasoningOutOfOrder.selector, 7, 7)
        );
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 6, abi.encodeWithSelector(IAgentVault.ReasoningOutOfOrder.selector, 6, 7)
        );
        _execute(_sell(SELL_AMOUNT), 9);
    }

    function test_executeSwap_checksSequenceBeforeAmount() public {
        _expectExecuteRevert(_sell(0), 0, abi.encodeWithSelector(IAgentVault.ReasoningOutOfOrder.selector, 0, 0));
    }

    function test_executeSwap_revertsOnZeroAmount_beforePairCheck() public {
        IAgentVault.SwapRequest memory request = _sell(0);
        request.tokenOut = request.tokenIn;
        _expectExecuteRevert(request, 1, abi.encodeWithSelector(IAgentVault.ZeroAmount.selector));
    }

    function test_executeSwap_revertsOnSameToken_beforeAllowListCheck() public {
        IAgentVault.SwapRequest memory request = _sell(SELL_AMOUNT);
        request.tokenIn = stranger;
        request.tokenOut = stranger;
        _expectExecuteRevert(request, 1, abi.encodeWithSelector(IAgentVault.InvalidPair.selector));
    }

    function test_executeSwap_reportsTokenInFirstWhenNeitherTokenIsAllowed() public {
        address unlistedIn = makeAddr("unlistedIn");
        address unlistedOut = makeAddr("unlistedOut");
        IAgentVault.SwapRequest memory request = _sell(SELL_AMOUNT);
        request.tokenIn = unlistedIn;
        request.tokenOut = unlistedOut;
        _expectExecuteRevert(request, 1, abi.encodeWithSelector(IAgentVault.TokenNotAllowed.selector, unlistedIn));
    }

    function test_executeSwap_revertsOnUnlistedTokenOut() public {
        IAgentVault.SwapRequest memory request = _sell(SELL_AMOUNT);
        request.tokenOut = stranger;
        _expectExecuteRevert(request, 1, abi.encodeWithSelector(IAgentVault.TokenNotAllowed.selector, stranger));
    }

    function test_executeSwap_checksAllowListBeforePoolFee() public {
        IAgentVault.SwapRequest memory request = _sell(SELL_AMOUNT);
        request.tokenOut = stranger;
        request.poolFee = 500;
        _expectExecuteRevert(request, 1, abi.encodeWithSelector(IAgentVault.TokenNotAllowed.selector, stranger));
    }

    function test_executeSwap_revertsOnUnapprovedPoolFee_beforeCooldown() public {
        _execute(_sell(SELL_AMOUNT), 1);
        IAgentVault.SwapRequest memory request = _sell(SELL_AMOUNT);
        request.poolFee = 10_000;
        _expectExecuteRevert(request, 2, abi.encodeWithSelector(IAgentVault.PoolFeeNotAllowed.selector, 10_000));
    }

    function test_executeSwap_revertsForAPairWithoutApprovedFee() public {
        MockERC20 third = new MockERC20("Third", "THR", 8);
        vm.prank(owner);
        vault.configureToken(address(third), address(0), 48, true);
        IAgentVault.SwapRequest memory request = _sell(SELL_AMOUNT);
        request.tokenOut = address(third);
        _expectExecuteRevert(request, 1, abi.encodeWithSelector(IAgentVault.PoolFeeNotAllowed.selector, POOL_FEE));
    }

    function test_executeSwap_revertsForRemovedToken_beforeCooldown() public {
        _execute(_sell(SELL_AMOUNT), 1);
        vm.prank(owner);
        vault.removeToken(address(usdc));
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 2, abi.encodeWithSelector(IAgentVault.TokenNotAllowed.selector, address(usdc))
        );
    }

    function test_executeSwap_enforcesTheCooldownBoundary() public {
        _execute(_sell(SELL_AMOUNT), 1);

        vm.warp(START + 59);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 2, abi.encodeWithSelector(IAgentVault.CooldownActive.selector, START + 60)
        );

        vm.warp(START + 60);
        _execute(_sell(SELL_AMOUNT), 2);
    }

    function test_executeSwap_checksCooldownBeforeOracles() public {
        _execute(_sell(SELL_AMOUNT), 1);
        hbarUsd.setAnswer(0, block.timestamp);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 2, abi.encodeWithSelector(IAgentVault.CooldownActive.selector, START + 60)
        );
    }

    function test_executeSwap_rejectsNonPositiveChainlinkAnswers() public {
        int256[2] memory answers = [int256(0), -1];
        for (uint256 i = 0; i < answers.length; ++i) {
            hbarUsd.setAnswer(answers[i], block.timestamp);
            _expectExecuteRevert(
                _sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.InvalidOraclePrice.selector, address(whbar))
            );
        }
    }

    function test_executeSwap_rejectsChainlinkRoundWithoutTimestamp() public {
        hbarUsd.setAnswer(CHAINLINK_HBAR_USD, 0);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.InvalidOraclePrice.selector, address(whbar))
        );
    }

    function test_executeSwap_chainlinkStalenessBoundary() public {
        vm.warp(START + 7201);
        _setSupra(SUPRA_HBAR_USDT, 18, SUPRA_HBAR_USDT_PRICE, block.timestamp);
        _setSupra(SUPRA_USDC_USD, 8, SUPRA_USDC_USD_PRICE, block.timestamp);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.StalePrice.selector, address(whbar), START, 7200)
        );

        vm.warp(START + 7200);
        _execute(_sell(SELL_AMOUNT), 1);
    }

    function test_executeSwap_supraStalenessBoundaryInMilliseconds() public {
        uint256 now_ = START + 10_000;
        vm.warp(now_);
        _refreshOracles();

        supra.setSvalue(SUPRA_HBAR_USDT, 18, SUPRA_HBAR_USDT_PRICE, (now_ - 7200) * 1000 - 1);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT),
            1,
            abi.encodeWithSelector(IAgentVault.StalePrice.selector, address(whbar), now_ - 7201, 7200)
        );

        supra.setSvalue(SUPRA_HBAR_USDT, 18, SUPRA_HBAR_USDT_PRICE, (now_ - 7200) * 1000);
        _execute(_sell(SELL_AMOUNT), 1);
    }

    function test_executeSwap_acceptsSupraTimestampsInSeconds() public {
        supra.setSvalue(SUPRA_HBAR_USDT, 18, SUPRA_HBAR_USDT_PRICE, START - 30);
        assertEq(vault.oracleReading(address(whbar)).crossCheckUpdatedAt, START - 30);
        _execute(_sell(SELL_AMOUNT), 1);
    }

    function test_executeSwap_toleratesOracleClocksAheadOfTheBlock() public {
        hbarUsd.setAnswer(CHAINLINK_HBAR_USD, START + 5);
        _setSupra(SUPRA_HBAR_USDT, 18, SUPRA_HBAR_USDT_PRICE, START + 5);
        _execute(_sell(SELL_AMOUNT), 1);
    }

    function test_executeSwap_rejectsZeroSupraCrossCheck() public {
        _setSupra(SUPRA_HBAR_USDT, 18, 0, START);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.InvalidOraclePrice.selector, address(whbar))
        );
    }

    function test_executeSwap_checksChainlinkFreshnessBeforeSupraValidity() public {
        vm.warp(START + 7201);
        _setSupra(SUPRA_HBAR_USDT, 18, 0, block.timestamp);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.StalePrice.selector, address(whbar), START, 7200)
        );
    }

    function test_executeSwap_checksSupraValidityBeforeItsFreshness() public {
        vm.warp(START + 7201);
        hbarUsd.setAnswer(CHAINLINK_HBAR_USD, block.timestamp);
        _setSupra(SUPRA_HBAR_USDT, 18, 0, START);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.InvalidOraclePrice.selector, address(whbar))
        );
    }

    function test_executeSwap_checksSupraFreshnessBeforeDivergence() public {
        vm.warp(START + 7201);
        hbarUsd.setAnswer(CHAINLINK_HBAR_USD, block.timestamp);
        _setSupra(SUPRA_HBAR_USDT, 18, 2 * HBAR_E18, START);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.StalePrice.selector, address(whbar), START, 7200)
        );
    }

    function test_executeSwap_divergenceBoundaryAboveAndBelowChainlink() public {
        uint256[2] memory allowed = [HBAR_E18 * 10_150 / 10_000, HBAR_E18 * 9850 / 10_000];
        uint256[2] memory rejected = [HBAR_E18 * 10_151 / 10_000, HBAR_E18 * 9849 / 10_000];
        for (uint64 i = 0; i < 2; ++i) {
            vm.warp(START + i * 60);
            _refreshOracles();
            _setSupra(SUPRA_HBAR_USDT, 18, rejected[i], block.timestamp);
            _expectExecuteRevert(
                _sell(SELL_AMOUNT),
                i + 1,
                abi.encodeWithSelector(IAgentVault.OracleDivergence.selector, address(whbar), 151, 150)
            );

            _setSupra(SUPRA_HBAR_USDT, 18, allowed[i], block.timestamp);
            assertEq(vault.oracleReading(address(whbar)).divergenceBps, 150);
            _execute(_sell(SELL_AMOUNT), i + 1);
        }
    }

    function test_executeSwap_checksTokenInOraclesBeforeTokenOut() public {
        hbarUsd.setAnswer(0, block.timestamp);
        _setSupra(SUPRA_USDC_USD, 8, 0, block.timestamp);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.InvalidOraclePrice.selector, address(whbar))
        );
        _expectExecuteRevert(
            _buy(BUY_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.InvalidOraclePrice.selector, address(usdc))
        );
    }

    function test_executeSwap_pricesASupraOnlyTokenWithSupra() public {
        vm.prank(owner);
        vault.configureToken(address(whbar), address(0), SUPRA_HBAR_USDT, true);

        IAgentVault.OracleReading memory reading = vault.oracleReading(address(whbar));
        assertEq(abi.encode(reading), abi.encode(IAgentVault.OracleReading(SUPRA_HBAR_USDT_PRICE, START, 0, 0, 0)));

        hbarUsd.setAnswer(0, START);
        _execute(_sell(SELL_AMOUNT), 1);
        assertEq(vault.spentUsdOn(START / 1 days), SELL_AMOUNT * SUPRA_HBAR_USDT_PRICE / 1e8);
    }

    function test_executeSwap_rejectsAZeroSupraOnlyPrice() public {
        _setSupra(SUPRA_USDC_USD, 8, 0, START);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.InvalidOraclePrice.selector, address(usdc))
        );
    }

    function test_executeSwap_ignoresSupraWhenDisabled() public {
        vm.prank(owner);
        vault.configureToken(address(whbar), address(hbarUsd), SUPRA_HBAR_USDT, false);
        _setSupra(SUPRA_HBAR_USDT, 18, 0, 0);

        assertEq(
            abi.encode(vault.oracleReading(address(whbar))),
            abi.encode(IAgentVault.OracleReading(HBAR_E18, START, 0, 0, 0))
        );
        _execute(_sell(SELL_AMOUNT), 1);
    }

    function test_executeSwap_rejectsTradesTooSmallToPrice() public {
        _expectExecuteRevert(_sell(1), 1, abi.encodeWithSelector(IAgentVault.ZeroAmount.selector));
    }

    function test_executeSwap_checksOraclesBeforePolicyLimits() public {
        vm.warp(START + 7201);
        _expectExecuteRevert(
            _sell(1_000_000e8), 1, abi.encodeWithSelector(IAgentVault.StalePrice.selector, address(whbar), START, 7200)
        );
    }

    function test_executeSwap_tradeSizeBoundary() public {
        IAgentVault.Policy memory sized = _policy();
        sized.maxTradeUsd = SELL_USD - 1;
        _setPolicy(sized);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.TradeTooLarge.selector, SELL_USD, SELL_USD - 1)
        );

        sized.maxTradeUsd = SELL_USD;
        _setPolicy(sized);
        _execute(_sell(SELL_AMOUNT), 1);
    }

    function test_executeSwap_checksTradeSizeBeforeDailyCap() public {
        IAgentVault.Policy memory capped = _policy();
        capped.maxTradeUsd = SELL_USD;
        capped.dailyCapUsd = SELL_USD;
        _setPolicy(capped);
        _execute(_sell(SELL_AMOUNT), 1);

        vm.warp(START + 60);
        _expectExecuteRevert(
            _sell(2 * SELL_AMOUNT),
            2,
            abi.encodeWithSelector(IAgentVault.TradeTooLarge.selector, 2 * SELL_USD, SELL_USD)
        );
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 2, abi.encodeWithSelector(IAgentVault.DailyCapExceeded.selector, SELL_USD, 0)
        );
    }

    function test_executeSwap_dailyCapResetsAtUtcMidnight() public {
        IAgentVault.Policy memory capped = _policy();
        capped.dailyCapUsd = capped.maxTradeUsd;
        capped.cooldown = 0;
        _setPolicy(capped);

        uint256 day = START / 1 days;
        uint256 lastSecond = (day + 1) * 1 days - 1;
        uint256 usd = 20e6 * USDC_E18 / 1e6;

        vm.warp(lastSecond - 10);
        _refreshOracles();
        _execute(_buy(20e6), 1);

        vm.warp(lastSecond);
        _expectExecuteRevert(
            _buy(20e6), 2, abi.encodeWithSelector(IAgentVault.DailyCapExceeded.selector, usd, 25e18 - usd)
        );

        vm.warp(lastSecond + 1);
        assertEq(vault.remainingDailyUsd(), 25e18);
        _execute(_buy(20e6), 2);
        assertEq(vault.spentUsdOn(day), usd);
        assertEq(vault.spentUsdOn(day + 1), usd);
    }

    function test_executeSwap_loweredCapBelowTodaysSpendingStopsTrading() public {
        _execute(_sell(SELL_AMOUNT), 1);
        IAgentVault.Policy memory lowered = _policy();
        lowered.maxTradeUsd = 1e18;
        lowered.dailyCapUsd = 1e18;
        _setPolicy(lowered);
        assertEq(vault.remainingDailyUsd(), 0);

        vm.warp(START + 60);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT / 2), 2, abi.encodeWithSelector(IAgentVault.DailyCapExceeded.selector, SELL_USD / 2, 0)
        );
    }

    function test_executeSwap_routerRefusesOutputBelowTheMinimum() public {
        router.setRate(address(whbar), address(usdc), (SELL_MIN_OUT - 1) * 1e18 / SELL_AMOUNT);
        _expectExecuteRevert(_sell(SELL_AMOUNT), 1, bytes("Too little received"));
    }

    function test_executeSwap_revertsWhenARouterIgnoresTheMinimum() public {
        UnderpayingRouter cheat = new UnderpayingRouter();
        usdc.mint(address(cheat), 1_000e6);
        cheat.setFill(SELL_MIN_OUT - 1, 10_000);
        vault = _deployVault(address(cheat), agent);

        _expectExecuteRevert(
            _sell(SELL_AMOUNT),
            1,
            abi.encodeWithSelector(IAgentVault.InsufficientOutput.selector, SELL_MIN_OUT - 1, SELL_MIN_OUT)
        );
    }

    function test_executeSwap_blocksReentryFromTheRouter() public {
        ReentrantRouter reentrant = new ReentrantRouter();
        AgentVault target = _deployVault(address(reentrant), address(reentrant));
        reentrant.setVault(target);

        vm.prank(address(reentrant));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        target.executeSwap(_sell(SELL_AMOUNT), _reasoning(1));
    }

    // ---------------------------------------------------------------- views

    function test_views_reportStaleAndDivergingOraclesWithoutReverting() public {
        vm.warp(START + 1 days);
        _setSupra(SUPRA_HBAR_USDT, 18, 2 * HBAR_E18, START);

        IAgentVault.Quote memory quoted = vault.quote(_sell(SELL_AMOUNT));
        assertEq(quoted.tokenIn.updatedAt, START);
        assertEq(quoted.tokenIn.divergenceBps, 10_000);
        _expectExecuteRevert(
            _sell(SELL_AMOUNT), 1, abi.encodeWithSelector(IAgentVault.StalePrice.selector, address(whbar), START, 7200)
        );
    }

    function test_quote_matchesTheVectorAndIgnoresPolicyLimits() public view {
        IAgentVault.Quote memory quoted = vault.quote(_sell(100 * SELL_AMOUNT));
        assertEq(quoted.usdValue, 100 * SELL_USD);

        quoted = vault.quote(_sell(SELL_AMOUNT));
        assertEq(quoted.usdValue, SELL_USD);
        assertEq(quoted.expectedOut, SELL_EXPECTED_OUT);
        assertEq(quoted.minAmountOut, SELL_MIN_OUT);
    }

    function test_quote_revertsForUnlistedTokens() public {
        IAgentVault.SwapRequest memory request = _sell(SELL_AMOUNT);
        request.tokenOut = stranger;
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.TokenNotAllowed.selector, stranger));
        vault.quote(request);
    }

    function test_quote_revertsOnNonPositivePrices() public {
        hbarUsd.setAnswer(-5, START);
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.InvalidOraclePrice.selector, address(whbar)));
        vault.quote(_sell(SELL_AMOUNT));
    }

    function test_oracleReading_reportsChainlinkWithItsSupraCrossCheck() public view {
        assertEq(
            abi.encode(vault.oracleReading(address(whbar))),
            abi.encode(IAgentVault.OracleReading(HBAR_E18, START, SUPRA_HBAR_USDT_PRICE, START, HBAR_DIVERGENCE_BPS))
        );
        assertEq(
            abi.encode(vault.oracleReading(address(usdc))),
            abi.encode(IAgentVault.OracleReading(USDC_E18, START, 0, 0, 0))
        );
    }

    function test_oracleReading_revertsForUnknownToken() public {
        vm.expectRevert(abi.encodeWithSelector(IAgentVault.TokenNotAllowed.selector, stranger));
        vault.oracleReading(stranger);
    }

    function test_nextTradeAt_isZeroBeforeTheFirstTrade() public view {
        assertEq(vault.nextTradeAt(), 0);
        assertEq(vault.remainingDailyUsd(), 100e18);
    }

    function _installHts(int64 responseCode) private {
        vm.etch(HTS, address(new MockHederaTokenService()).code);
        MockHederaTokenService(HTS).setResponseCode(responseCode);
    }
}
