// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { CommonBase } from "forge-std/Base.sol";
import { StdCheats } from "forge-std/StdCheats.sol";
import { StdUtils } from "forge-std/StdUtils.sol";

import { AgentVault } from "../contracts/AgentVault.sol";
import { IAgentVault } from "../contracts/interfaces/IAgentVault.sol";
import { MockAggregatorV3 } from "./mocks/MockAggregatorV3.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockSupra } from "./mocks/MockSupra.sol";
import { AgentVaultFixture } from "./utils/AgentVaultFixture.sol";

/// @notice Drives the vault the way its three roles can: the agent trades, the owner withdraws and pauses, and anyone
///         (agent included) tries to withdraw. Ghost variables record what the invariants compare against.
contract AgentVaultHandler is CommonBase, StdCheats, StdUtils {
    AgentVault private immutable _vault;
    MockERC20 private immutable _whbar;
    MockERC20 private immutable _usdc;
    MockAggregatorV3 private immutable _hbarUsd;
    MockSupra private immutable _supra;
    address private immutable _owner;
    address private immutable _agent;

    address[2] public recipients = [makeAddr("treasury"), makeAddr("coldWallet")];

    uint256 public trades;
    uint64 public lastSequence;
    bool public sequenceWentBackwards;
    uint256 public withdrawalsByNonOwners;
    mapping(address token => uint256 amount) public withdrawn;
    uint256[] public tradingDays;

    constructor(
        AgentVault vault,
        MockERC20 whbar,
        MockERC20 usdc,
        MockAggregatorV3 hbarUsd,
        MockSupra supra,
        address owner,
        address agent
    ) {
        _vault = vault;
        _whbar = whbar;
        _usdc = usdc;
        _hbarUsd = hbarUsd;
        _supra = supra;
        _owner = owner;
        _agent = agent;
    }

    function trade(bool sell, uint256 amountIn, uint256 sequenceStep, uint256 delay) external {
        vm.warp(block.timestamp + bound(delay, 1, 1 hours));
        _hbarUsd.setAnswer(10_245_000, block.timestamp);
        _supra.setSvalue(75, 18, 0.10328e18, block.timestamp * 1000);
        _supra.setSvalue(89, 8, 0.99997e8, block.timestamp * 1000);

        // Up to ~$31 per trade against a $25 limit, and a zero step that replays the last sequence number.
        amountIn = sell ? bound(amountIn, 1, 300e8) : bound(amountIn, 1, 31e6);
        IAgentVault.SwapRequest memory request = IAgentVault.SwapRequest({
            tokenIn: sell ? address(_whbar) : address(_usdc),
            tokenOut: sell ? address(_usdc) : address(_whbar),
            poolFee: 3000,
            amountIn: amountIn
        });
        uint64 sequence = _vault.lastReasoningSequence() + uint64(bound(sequenceStep, 0, 3));
        IAgentVault.Reasoning memory reasoning =
            IAgentVault.Reasoning({ hash: keccak256(abi.encode(sequence)), sequence: sequence });

        vm.prank(_agent);
        try _vault.executeSwap(request, reasoning) {
            if (sequence <= lastSequence) sequenceWentBackwards = true;
            lastSequence = sequence;
            ++trades;
            uint256 today = block.timestamp / 1 days;
            if (tradingDays.length == 0 || tradingDays[tradingDays.length - 1] != today) tradingDays.push(today);
        } catch { }
    }

    function withdraw(uint256 callerSeed, bool base, uint256 amount, uint256 recipientSeed) external {
        address[3] memory callers = [_owner, _agent, makeAddr("stranger")];
        address caller = callers[callerSeed % callers.length];
        MockERC20 token = base ? _whbar : _usdc;
        uint256 balance = token.balanceOf(address(_vault));
        if (balance == 0) return;
        amount = bound(amount, 1, balance / 10 + 1);
        address to = recipients[recipientSeed % recipients.length];

        vm.prank(caller);
        try _vault.withdraw(address(token), amount, to) {
            if (caller != _owner) ++withdrawalsByNonOwners;
            withdrawn[address(token)] += amount;
        } catch { }
    }

    /// @dev The owner pauses now and then; most of the time the vault is open for trading.
    function setPaused(uint256 seed) external {
        bool pause = seed % 4 == 0;
        if (pause == _vault.paused()) return;
        vm.prank(_owner);
        if (pause) _vault.pause();
        else _vault.unpause();
    }

    function tradingDayCount() external view returns (uint256) {
        return tradingDays.length;
    }
}

contract AgentVaultInvariantTest is AgentVaultFixture {
    AgentVaultHandler private handler;

    function setUp() public override {
        super.setUp();
        // Two maximum-size trades fill a day, so runs keep running into the cap.
        IAgentVault.Policy memory tight = _policy();
        tight.dailyCapUsd = 2 * tight.maxTradeUsd;
        _setPolicy(tight);

        handler = new AgentVaultHandler(vault, whbar, usdc, hbarUsd, supra, owner, agent);
        targetContract(address(handler));
    }

    function invariant_dailySpendingNeverExceedsTheCap() public view {
        uint256 cap = vault.policy().dailyCapUsd;
        assertLe(vault.spentUsdOn(block.timestamp / 1 days), cap);
        for (uint256 i = 0; i < handler.tradingDayCount(); ++i) {
            assertLe(vault.spentUsdOn(handler.tradingDays(i)), cap);
        }
    }

    function invariant_reasoningSequenceStrictlyIncreasesWithEveryTrade() public view {
        assertFalse(handler.sequenceWentBackwards());
        assertEq(vault.tradeCount(), handler.trades());
        assertEq(vault.lastReasoningSequence(), handler.lastSequence());
    }

    /// @dev Tokens were minted only to the vault and the router. If they now sit anywhere other than the vault, the
    ///      router or an address the owner withdrew to, the vault moved them somewhere it must not.
    function invariant_tokensMoveOnlyThroughTheRouterOrOwnerWithdrawals() public view {
        MockERC20[2] memory tokens = [whbar, usdc];
        for (uint256 i = 0; i < tokens.length; ++i) {
            uint256 withdrawnTotal =
                tokens[i].balanceOf(handler.recipients(0)) + tokens[i].balanceOf(handler.recipients(1));
            assertEq(withdrawnTotal, handler.withdrawn(address(tokens[i])));
            assertEq(
                tokens[i].balanceOf(address(vault)) + tokens[i].balanceOf(address(router)) + withdrawnTotal,
                tokens[i].totalSupply()
            );
            assertEq(tokens[i].allowance(address(vault), address(router)), 0);
        }
    }

    function invariant_theAgentCanNeverWithdraw() public view {
        assertEq(handler.withdrawalsByNonOwners(), 0);
        assertEq(whbar.balanceOf(agent), 0);
        assertEq(usdc.balanceOf(agent), 0);
    }
}
