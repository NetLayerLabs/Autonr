// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAgentVault } from "../contracts/interfaces/IAgentVault.sol";
import { MockAggregatorV3 } from "../test/mocks/MockAggregatorV3.sol";
import { MockERC20 } from "../test/mocks/MockERC20.sol";
import { MockSupra } from "../test/mocks/MockSupra.sol";
import { MockSwapRouter } from "../test/mocks/MockSwapRouter.sol";

/// @title HelperConfig
/// @notice Everything AgentVault needs on each network. The Hedera values mirror packages/agent/src/networks.ts
///         (checked on-chain on 2026-10-01); change both together. A local chain gets freshly deployed mocks.
abstract contract HelperConfig {
    uint256 internal constant HEDERA_MAINNET_CHAIN_ID = 295;
    uint256 internal constant HEDERA_TESTNET_CHAIN_ID = 296;
    uint256 internal constant LOCAL_CHAIN_ID = 31_337;

    uint32 internal constant SUPRA_HBAR_USDT = 75;
    uint32 internal constant SUPRA_USDC_USD = 89;

    /// @param token Token address; HTS tokens are reached through their long-zero address.
    /// @param decimals Token decimals.
    /// @param chainlinkFeed Chainlink USD feed pricing the token, or address(0) when Supra alone prices it.
    /// @param supraPairId Supra pair that cross-checks the Chainlink feed, or prices the token alone.
    struct TokenSetup {
        address token;
        uint8 decimals;
        address chainlinkFeed;
        uint32 supraPairId;
    }

    /// @param router SaucerSwap V2 SwapRouter.
    /// @param supra Supra push oracle.
    /// @param baseToken The asset the agent manages (WHBAR).
    /// @param quoteToken The USD stablecoin (USDC).
    /// @param poolFee SaucerSwap V2 fee tier of the base/quote pool; the deploy script approves it on the vault, and the
    ///        agent trades in whatever tier the vault approves.
    struct NetworkConfig {
        address router;
        address supra;
        TokenSetup baseToken;
        TokenSetup quoteToken;
        uint24 poolFee;
    }

    error UnsupportedChain(uint256 chainId);

    /// @dev Deploys mocks on a local chain, so call it inside the broadcast when deploying there.
    function _networkConfig() internal returns (NetworkConfig memory) {
        if (block.chainid == HEDERA_TESTNET_CHAIN_ID) return _hederaTestnet();
        if (block.chainid == HEDERA_MAINNET_CHAIN_ID) return _hederaMainnet();
        if (block.chainid == LOCAL_CHAIN_ID) return _deployLocalMocks();
        revert UnsupportedChain(block.chainid);
    }

    function _isHedera() internal view returns (bool) {
        return block.chainid == HEDERA_MAINNET_CHAIN_ID || block.chainid == HEDERA_TESTNET_CHAIN_ID;
    }

    /// @notice Policy a fresh vault starts with: $25 per trade, $100 per UTC day, one trade a minute, prices at most
    ///         two hours old (one day on testnet), 3% slippage, 1.5% Chainlink/Supra disagreement.
    /// @dev Testnet's Chainlink HBAR / USD feed updates far less often than mainnet's (observed over two hours old on
    ///      2026-10-01), so a two-hour limit would refuse most testnet trades with StalePrice.
    function _defaultPolicy() internal view returns (IAgentVault.Policy memory) {
        return IAgentVault.Policy({
            maxTradeUsd: 25e18,
            dailyCapUsd: 100e18,
            cooldown: 60,
            maxPriceAge: block.chainid == HEDERA_TESTNET_CHAIN_ID ? 86_400 : 7200,
            maxSlippageBps: 300,
            maxOracleDivergenceBps: 150
        });
    }

    function _hederaTestnet() internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            router: 0x0000000000000000000000000000000000159398, // 0.0.1414040 SaucerSwapV2SwapRouter
            supra: 0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917, // 0.0.2664858
            baseToken: TokenSetup({
                token: 0x0000000000000000000000000000000000003aD2, // WHBAR 0.0.15058
                decimals: 8,
                chainlinkFeed: 0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a, // HBAR / USD
                supraPairId: SUPRA_HBAR_USDT
            }),
            quoteToken: TokenSetup({
                token: 0x0000000000000000000000000000000000001549, // USDC 0.0.5449
                decimals: 6,
                chainlinkFeed: address(0),
                supraPairId: SUPRA_USDC_USD
            }),
            poolFee: 3000
        });
    }

    function _hederaMainnet() internal pure returns (NetworkConfig memory) {
        return NetworkConfig({
            router: 0x00000000000000000000000000000000003c437A, // 0.0.3949434 SaucerSwapV2SwapRouter
            supra: 0xD02cc7a670047b6b012556A88e275c685d25e0c9, // 0.0.4322850
            baseToken: TokenSetup({
                token: 0x0000000000000000000000000000000000163B5a, // WHBAR 0.0.1456986
                decimals: 8,
                chainlinkFeed: 0xAF685FB45C12b92b5054ccb9313e135525F9b5d5, // HBAR / USD
                supraPairId: SUPRA_HBAR_USDT
            }),
            quoteToken: TokenSetup({
                token: 0x000000000000000000000000000000000006f89a, // USDC 0.0.456858
                decimals: 6,
                chainlinkFeed: address(0),
                supraPairId: SUPRA_USDC_USD
            }),
            poolFee: 1500
        });
    }

    /// @dev Prices match the shared oracle-math vectors (HBAR $0.10245 on Chainlink, $0.10328 on Supra, USDC
    ///      $0.99997), and the router pays slightly under the oracle-fair rate, so a local trade passes every guard.
    function _deployLocalMocks() internal returns (NetworkConfig memory config) {
        MockERC20 whbar = new MockERC20("Wrapped HBAR", "WHBAR", 8);
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockAggregatorV3 hbarUsd = new MockAggregatorV3(8, 10_245_000);

        // Supra reports milliseconds on Hedera; the mock does the same.
        MockSupra supra = new MockSupra();
        supra.setSvalue(SUPRA_HBAR_USDT, 18, 0.10328e18, block.timestamp * 1000);
        supra.setSvalue(SUPRA_USDC_USD, 8, 0.99997e8, block.timestamp * 1000);

        MockSwapRouter router = new MockSwapRouter();
        router.setRate(address(whbar), address(usdc), 1.0245e15);
        router.setRate(address(usdc), address(whbar), 976e18);
        whbar.mint(address(router), 1_000_000e8);
        usdc.mint(address(router), 100_000e6);

        config = NetworkConfig({
            router: address(router),
            supra: address(supra),
            baseToken: TokenSetup({
                token: address(whbar), decimals: 8, chainlinkFeed: address(hbarUsd), supraPairId: SUPRA_HBAR_USDT
            }),
            quoteToken: TokenSetup({
                token: address(usdc), decimals: 6, chainlinkFeed: address(0), supraPairId: SUPRA_USDC_USD
            }),
            poolFee: 3000
        });
    }

    /// @dev Gives a local vault something to trade: 1,000 WHBAR and 100 USDC of the mock tokens.
    function _fundLocalVault(NetworkConfig memory config, address vault) internal {
        MockERC20(config.baseToken.token).mint(vault, 1_000e8);
        MockERC20(config.quoteToken.token).mint(vault, 100e6);
    }
}
