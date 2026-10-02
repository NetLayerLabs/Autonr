// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { console2 } from "forge-std/console2.sol";

import { AgentVault } from "../contracts/AgentVault.sol";
import { IHederaTokenService } from "../contracts/interfaces/IHederaTokenService.sol";
import { ScaffoldHbarDeploy } from "./DeployHelpers.s.sol";
import { HelperConfig } from "./HelperConfig.s.sol";

/// @title DeployAgentVault
/// @notice Deploys AgentVault owned by the deployer, allows the network's base and quote tokens, approves the pair's
///         SaucerSwap fee tier and, on Hedera, associates the vault with both tokens so it can hold them.
/// @dev Reads two optional variables, normally from packages/agent/.env: AUTONR_AGENT_ADDRESS (default: the deployer)
///      and AUTONR_TOPIC_ID ("0.0.N"; default: none, which keeps trading disabled until the owner sets a topic).
contract DeployAgentVault is ScaffoldHbarDeploy, HelperConfig {
    address private constant HTS = address(0x167);
    int64 private constant HTS_SUCCESS = 22;

    /// @dev Hedera charges the association fee as gas (about 0.7M) and eth_estimateGas undercounts HTS work, so these
    ///      calls carry a fixed limit. Hedera bills at least 80% of a limit, so it is not set higher than needed.
    uint256 private constant ASSOCIATE_GAS_LIMIT = 1_000_000;

    error InvalidTopicId(string topicId);

    function run() external ScaffoldHbarDeployerRunner {
        NetworkConfig memory config = _networkConfig();
        if (_isHedera()) _answerHtsCallsLocally(config);

        AgentVault vault = new AgentVault(
            deployer, config.router, config.supra, _agentAddress(), _decisionTopicNum(), _defaultPolicy()
        );
        _configureToken(vault, config.baseToken);
        _configureToken(vault, config.quoteToken);
        vault.setPoolFee(config.baseToken.token, config.quoteToken.token, config.poolFee);

        if (_isHedera()) {
            vault.associateToken{ gas: ASSOCIATE_GAS_LIMIT }(config.baseToken.token);
            vault.associateToken{ gas: ASSOCIATE_GAS_LIMIT }(config.quoteToken.token);
        } else {
            _fundLocalVault(config, address(vault));
        }

        deployments.push(Deployment({ name: "AgentVault", addr: address(vault) }));
        console2.log("AgentVault:", address(vault));
        console2.log("Agent:", vault.agent());
        console2.log("Decision topic number (0 = not set yet):", vault.hcsTopicNum());
    }

    /// @dev Supra cross-checks a token that has a Chainlink feed and prices it alone otherwise, so it is always on.
    function _configureToken(AgentVault vault, TokenSetup memory setup) private {
        vault.configureToken(setup.token, setup.chainlinkFeed, setup.supraPairId, true);
    }

    /// @dev forge runs this script in a local EVM before broadcasting it, and that EVM cannot execute the Hedera Token
    ///      Service: the relay reports 0x167 as a lone INVALID opcode and every HTS token as an EIP-7702 delegation to
    ///      it. The two HTS calls the vault makes while being set up are answered locally with what Hedera returns.
    ///      The mocks never leave this process: the broadcast transactions run against the real HTS. The Makefile
    ///      passes --skip-simulation on Hedera because forge's simulation would replay them on a fork without mocks.
    function _answerHtsCallsLocally(NetworkConfig memory config) private {
        _mockDecimals(config.baseToken);
        _mockDecimals(config.quoteToken);
        vm.mockCall(HTS, abi.encodeWithSelector(IHederaTokenService.associateToken.selector), abi.encode(HTS_SUCCESS));
    }

    function _mockDecimals(TokenSetup memory setup) private {
        vm.mockCall(setup.token, abi.encodeCall(IERC20Metadata.decimals, ()), abi.encode(setup.decimals));
    }

    function _agentAddress() private view returns (address) {
        string memory configured = vm.envOr("AUTONR_AGENT_ADDRESS", string(""));
        return bytes(configured).length == 0 ? deployer : vm.parseAddress(configured);
    }

    /// @dev The vault stores N of topic 0.0.N: decision topics on testnet and mainnet live in shard 0, realm 0.
    function _decisionTopicNum() private view returns (uint64) {
        string memory topicId = vm.envOr("AUTONR_TOPIC_ID", string(""));
        if (bytes(topicId).length == 0) return 0;

        string[] memory parts = vm.split(topicId, ".");
        if (parts.length != 3 || !_isSameString(parts[0], "0") || !_isSameString(parts[1], "0")) {
            revert InvalidTopicId(topicId);
        }
        try vm.parseUint(parts[2]) returns (uint256 topicNum) {
            return SafeCast.toUint64(topicNum);
        } catch {
            revert InvalidTopicId(topicId);
        }
    }
}
