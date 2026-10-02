// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Test, Vm } from "forge-std/Test.sol";
import { htsSetup } from "hedera-forking/htsSetup.sol";

import { AgentVault } from "../../contracts/AgentVault.sol";
import { IAgentVault } from "../../contracts/interfaces/IAgentVault.sol";
import { HelperConfig } from "../../script/HelperConfig.s.sol";

/// @notice Runs AgentVault against the real SaucerSwap V2, Chainlink and Supra contracts on a Hedera fork.
/// @dev hedera-forking emulates the Hedera Token Service (0x167) and HTS tokens, fetching their state from the Mirror
///      Node through curl, hence FOUNDRY_PROFILE=fork (ffi on). Two Hedera quirks are handled here:
///      - Token code: hedera-forking v0.1.2 expects the relay to return the HIP-719 token proxy as an HTS token's
///        bytecode. Since EIP-7702 support (HIP-1340) the relay returns the delegation designator 0xef0100 ‖ 0x167,
///        which a forked EVM cannot run, so the proxy is etched back for every token the tests touch.
///      - Associations: the emulator only associates accounts that already exist on the network and does not check
///        associations on transfer, so a vault created in the fork is not associated here. The unit tests cover
///        `associateToken` against a stand-in for 0x167.
abstract contract HederaForkTest is Test, HelperConfig {
    uint64 internal constant TOPIC_NUM = 7_000_001;

    /// @dev HIP-719 proxy runtime code (hedera-forking's template) around the 20-byte token address: it forwards each
    ///      call to 0x167 as `redirectForToken(token, calldata)`.
    bytes private constant HIP719_PROXY_HEAD = hex"6080604052348015600f57600080fd5b506000610167905077618dc65e";
    bytes private constant HIP719_PROXY_TAIL =
        hex"600052366000602037600080366018016008845af43d806000803e8160008114605857816000f35b816000fdfea2646970667358221220d8378feed472ba49a0005514ef7087017f707b45fb9bf56bb81bb93ff19a238b64736f6c634300080b0033";

    address internal agent = makeAddr("agent");

    function _forkHedera(string memory rpcAlias) internal returns (NetworkConfig memory config) {
        vm.createSelectFork(rpcAlias);
        config = block.chainid == HEDERA_MAINNET_CHAIN_ID ? _hederaMainnet() : _hederaTestnet();
        htsSetup();
        _etchTokenProxy(config.baseToken.token);
        _etchTokenProxy(config.quoteToken.token);
    }

    /// @dev The deployed default policy, except that prices may be up to a day old: feed heartbeats on Hedera range
    ///      from minutes to hours, and these tests are about the integration rather than the freshness rule.
    function _deployVault(NetworkConfig memory config) internal returns (AgentVault vault) {
        IAgentVault.Policy memory policy = _defaultPolicy();
        policy.maxPriceAge = 1 days;
        vault = new AgentVault(address(this), config.router, config.supra, agent, TOPIC_NUM, policy);
        vault.configureToken(config.baseToken.token, config.baseToken.chainlinkFeed, config.baseToken.supraPairId, true);
        vault.configureToken(config.quoteToken.token, address(0), config.quoteToken.supraPairId, true);
        vault.setPoolFee(config.baseToken.token, config.quoteToken.token, config.poolFee);
    }

    function _request(TokenSetup memory tokenIn, TokenSetup memory tokenOut, uint24 poolFee, uint256 amountIn)
        internal
        pure
        returns (IAgentVault.SwapRequest memory)
    {
        return IAgentVault.SwapRequest({
            tokenIn: tokenIn.token, tokenOut: tokenOut.token, poolFee: poolFee, amountIn: amountIn
        });
    }

    function _reasoning(uint64 sequence) internal pure returns (IAgentVault.Reasoning memory) {
        return IAgentVault.Reasoning({ hash: keccak256(abi.encode("fork decision", sequence)), sequence: sequence });
    }

    /// @dev Executes the swap as the agent and returns the TradeExecuted receipt after checking it against the
    ///      vault's quote from the same block and the balances that actually moved.
    function _executeAndCheck(AgentVault vault, IAgentVault.SwapRequest memory request, uint64 sequence)
        internal
        returns (IAgentVault.TradeReceipt memory receipt)
    {
        IAgentVault.Quote memory quoted = vault.quote(request);
        uint256 inBefore = IERC20(request.tokenIn).balanceOf(address(vault));
        uint256 outBefore = IERC20(request.tokenOut).balanceOf(address(vault));

        vm.recordLogs();
        vm.prank(agent);
        uint256 amountOut = vault.executeSwap(request, _reasoning(sequence));
        receipt = _tradeReceipt(vault, request);

        assertEq(receipt.amountOut, amountOut);
        assertGe(amountOut, quoted.minAmountOut);
        assertEq(receipt.minAmountOut, quoted.minAmountOut);
        assertEq(receipt.usdValue, quoted.usdValue);
        assertEq(abi.encode(receipt.oracleIn), abi.encode(quoted.tokenIn));
        assertEq(abi.encode(receipt.oracleOut), abi.encode(quoted.tokenOut));
        assertEq(receipt.hcsTopicNum, TOPIC_NUM);
        assertEq(receipt.hcsSequence, sequence);
        assertEq(IERC20(request.tokenIn).balanceOf(address(vault)), inBefore - request.amountIn);
        assertEq(IERC20(request.tokenOut).balanceOf(address(vault)), outBefore + amountOut);
        assertEq(IERC20(request.tokenIn).allowance(address(vault), address(vault.ROUTER())), 0);
    }

    function _tradeReceipt(AgentVault vault, IAgentVault.SwapRequest memory request)
        private
        view
        returns (IAgentVault.TradeReceipt memory)
    {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(vault) || logs[i].topics[0] != IAgentVault.TradeExecuted.selector) continue;
            assertEq(logs[i].topics[1], bytes32(vault.tradeCount()));
            assertEq(logs[i].topics[2], bytes32(uint256(uint160(request.tokenIn))));
            assertEq(logs[i].topics[3], bytes32(uint256(uint160(request.tokenOut))));
            return abi.decode(logs[i].data, (IAgentVault.TradeReceipt));
        }
        revert("TradeExecuted not emitted");
    }

    function _etchTokenProxy(address token) private {
        vm.etch(token, bytes.concat(HIP719_PROXY_HEAD, bytes20(token), HIP719_PROXY_TAIL));
    }
}
