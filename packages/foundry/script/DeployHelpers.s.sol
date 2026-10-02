//SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Script } from "forge-std/Script.sol";
import { Vm } from "forge-std/Vm.sol";

contract ScaffoldHbarDeploy is Script {
    error InvalidChain();
    error InvalidPrivateKey(string);

    event AnvilSetBalance(address account, uint256 amount);
    event FailedAnvilRequest();

    struct Deployment {
        string name;
        address addr;
    }

    string root;
    string path;
    Deployment[] public deployments;
    uint256 constant ANVIL_BASE_BALANCE = 10000 ether;

    /// @notice The deployer address for every run
    address deployer;

    /// @notice Use this modifier on your run() function on your deploy scripts
    modifier ScaffoldHbarDeployerRunner() {
        deployer = _startBroadcast();
        if (deployer == address(0)) {
            revert InvalidPrivateKey("Invalid private key");
        }
        _;
        _stopBroadcast();
        exportDeployments();
    }

    function _startBroadcast() internal returns (address) {
        vm.startBroadcast();
        (, address _deployer,) = vm.readCallers();

        if (block.chainid == 31337 && _deployer.balance == 0) {
            try vm.deal(_deployer, ANVIL_BASE_BALANCE) {
                emit AnvilSetBalance(_deployer, ANVIL_BASE_BALANCE);
            } catch {
                emit FailedAnvilRequest();
            }
        }
        return _deployer;
    }

    function _stopBroadcast() internal {
        vm.stopBroadcast();
    }

    /// @notice Writes deployments/<chainId>.json, keeping earlier entries of that chain that this run did not
    ///         replace, so a local deploy never wipes the committed testnet deployment.
    function exportDeployments() internal {
        root = vm.projectRoot();
        string memory directory = string.concat(root, "/deployments");
        if (!vm.exists(directory)) {
            vm.createDir(directory, true);
        }
        path = string.concat(directory, "/", vm.toString(block.chainid), ".json");

        string memory jsonWrite;

        if (vm.exists(path)) {
            string memory existingDeploymentsJson = vm.readFile(path);
            string[] memory keys = bytes(existingDeploymentsJson).length == 0
                ? new string[](0)
                : vm.parseJsonKeys(existingDeploymentsJson, ".");

            for (uint256 i = 0; i < keys.length; i++) {
                if (_isSameString(keys[i], "networkName")) {
                    continue;
                }

                string memory valuePath = string.concat(".", keys[i]);
                string memory deploymentName = vm.parseJsonString(existingDeploymentsJson, valuePath);

                if (_shouldPreserveExistingDeployment(keys[i], deploymentName)) {
                    vm.serializeString(jsonWrite, keys[i], deploymentName);
                }
            }
        }

        uint256 len = deployments.length;

        for (uint256 i = 0; i < len; i++) {
            vm.serializeString(jsonWrite, vm.toString(deployments[i].addr), deployments[i].name);
        }

        jsonWrite = vm.serializeString(jsonWrite, "networkName", _chainName());
        vm.writeJson(jsonWrite, path);
    }

    /// @dev forge 1.7.1 does not know Hedera's chain ids (vm.getChain reverts), and probing every RPC endpoint to find
    ///      the chain is slow on Hedera's relay, so the names match the foundry.toml [rpc_endpoints] aliases directly.
    function _chainName() internal returns (string memory) {
        if (block.chainid == 295) return "hedera_mainnet";
        if (block.chainid == 296) return "hedera_testnet";
        try vm.getChain(block.chainid) returns (Vm.Chain memory chain) {
            return chain.name;
        } catch {
            return findChainName();
        }
    }

    function findChainName() public returns (string memory) {
        uint256 thisChainId = block.chainid;
        string[2][] memory allRpcUrls = vm.rpcUrls();
        for (uint256 i = 0; i < allRpcUrls.length; i++) {
            try vm.createSelectFork(allRpcUrls[i][1]) {
                if (block.chainid == thisChainId) {
                    return allRpcUrls[i][0];
                }
            } catch {
                continue;
            }
        }
        revert InvalidChain();
    }

    function _shouldPreserveExistingDeployment(string memory existingAddress, string memory existingName)
        private
        view
        returns (bool shouldPreserve)
    {
        for (uint256 i = 0; i < deployments.length; i++) {
            if (
                _isSameString(existingAddress, vm.toString(deployments[i].addr))
                    || _isSameString(existingName, deployments[i].name)
            ) {
                return false;
            }
        }

        return true;
    }

    function _isSameString(string memory left, string memory right) internal pure returns (bool isSame) {
        return keccak256(bytes(left)) == keccak256(bytes(right));
    }
}
