// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ISaucerSwapV2SwapRouter } from "./ISaucerSwapV2SwapRouter.sol";
import { ISupraSValueFeed } from "./ISupraSValueFeed.sol";

/// @title IAgentVault
/// @notice A vault that lets an off-chain agent trade on SaucerSwap V2 without being trusted with prices or funds.
/// @dev The agent decides *whether* to trade. Oracles decide *at what price*: a token with a Chainlink feed is priced
///      by Chainlink and must be confirmed by Supra within a tolerance, a token without one (the USD quote token) is
///      priced by Supra alone. The vault derives `amountOutMinimum` itself and only then swaps, in the fee tier the
///      owner approved for the pair. Every trade must reference the HCS message (topic + sequence number + keccak256 of
///      the exact bytes) in which the agent published its reasoning, so anyone can later prove the reasoning existed
///      before the trade.
interface IAgentVault {
    /// @notice Per-token configuration. Only allowed tokens can be traded.
    /// @dev Pricing rule: with a Chainlink feed, Chainlink prices the token and Supra (if enabled) must agree within
    ///      `maxOracleDivergenceBps`. Without a Chainlink feed, Supra alone prices the token. A token needs at least one.
    /// @param allowed Whether the token may be used as tokenIn or tokenOut.
    /// @param decimals Token decimals, read from the token when it is configured.
    /// @param chainlinkFeed Chainlink AggregatorV3 feed quoting this token in USD (e.g. HBAR / USD), or address(0).
    /// @param supraPairId Supra push-oracle pair index (e.g. 75 = HBAR_USDT, 89 = USDC_USD).
    /// @param supraEnabled Whether Supra is used for this token (as cross-check, or as the sole source).
    struct TokenConfig {
        bool allowed;
        uint8 decimals;
        address chainlinkFeed;
        uint32 supraPairId;
        bool supraEnabled;
    }

    /// @notice Risk policy enforced on every trade. USD amounts use 18 decimals.
    /// @param maxTradeUsd Maximum USD notional of a single trade.
    /// @param dailyCapUsd Maximum cumulative USD notional per UTC day. Days are `block.timestamp / 1 days`, so the cap
    ///        resets at 00:00 UTC instead of rolling over the last 24 hours: up to twice the cap can trade around
    ///        midnight.
    /// @param cooldown Minimum seconds between two trades.
    /// @param maxPriceAge Maximum age, in seconds, of every oracle price used for a trade.
    /// @param maxSlippageBps Maximum shortfall of the swap output versus the oracle-fair output, in basis points.
    /// @param maxOracleDivergenceBps Maximum |Chainlink - Supra| / Chainlink, in basis points, for cross-checked tokens.
    struct Policy {
        uint256 maxTradeUsd;
        uint256 dailyCapUsd;
        uint32 cooldown;
        uint32 maxPriceAge;
        uint16 maxSlippageBps;
        uint16 maxOracleDivergenceBps;
    }

    /// @notice A single-hop exact-input swap requested by the agent. The agent never supplies a minimum output.
    /// @param tokenIn Token sold by the vault.
    /// @param tokenOut Token bought by the vault.
    /// @param poolFee SaucerSwap V2 fee tier of the tokenIn/tokenOut pool, in hundredths of a basis point. Must equal the
    ///        tier the owner approved for the pair with `setPoolFee`.
    /// @param amountIn Exact amount of tokenIn to sell, in tokenIn's smallest unit.
    struct SwapRequest {
        address tokenIn;
        address tokenOut;
        uint24 poolFee;
        uint256 amountIn;
    }

    /// @notice Pointer to the agent's published reasoning for this trade.
    /// @param hash keccak256 of the exact UTF-8 bytes of the HCS message.
    /// @param sequence HCS sequence number of that message on the vault's decision topic.
    struct Reasoning {
        bytes32 hash;
        uint64 sequence;
    }

    /// @notice One token's oracle reading as used by the vault. Prices use 18 decimals, times are unix seconds.
    /// @param priceE18 USD price used for the trade (Chainlink, or Supra for Supra-only tokens).
    /// @param updatedAt Update time of `priceE18`.
    /// @param crossCheckE18 Supra price used to cross-check Chainlink, or 0 when there is no cross-check.
    /// @param crossCheckUpdatedAt Update time of `crossCheckE18`, or 0.
    /// @param divergenceBps |priceE18 - crossCheckE18| / priceE18 in basis points, or 0 without a cross-check.
    struct OracleReading {
        uint256 priceE18;
        uint256 updatedAt;
        uint256 crossCheckE18;
        uint256 crossCheckUpdatedAt;
        uint256 divergenceBps;
    }

    /// @notice Oracle-derived pricing for a swap request.
    /// @param usdValue USD notional of amountIn, 18 decimals.
    /// @param expectedOut Oracle-fair amount of tokenOut for amountIn, before slippage tolerance.
    /// @param minAmountOut expectedOut reduced by maxSlippageBps; passed to the router as amountOutMinimum.
    /// @param tokenIn Oracle reading for tokenIn.
    /// @param tokenOut Oracle reading for tokenOut.
    struct Quote {
        uint256 usdValue;
        uint256 expectedOut;
        uint256 minAmountOut;
        OracleReading tokenIn;
        OracleReading tokenOut;
    }

    /// @notice Everything a verifier needs to audit one executed trade.
    /// @dev `amountIn` and `usdValue` describe what the router actually took, which is less than requested only when the
    ///      pool ran out of liquidity mid-swap. `minAmountOut` is the guard derived for the full request.
    struct TradeReceipt {
        uint256 amountIn;
        uint256 amountOut;
        uint256 minAmountOut;
        uint256 usdValue;
        OracleReading oracleIn;
        OracleReading oracleOut;
        bytes32 reasoningHash;
        uint64 hcsTopicNum;
        uint64 hcsSequence;
    }

    /// @notice Emitted once per successful swap.
    event TradeExecuted(
        uint256 indexed tradeId, address indexed tokenIn, address indexed tokenOut, TradeReceipt receipt
    );
    event AgentUpdated(address indexed previousAgent, address indexed newAgent);
    event PolicyUpdated(Policy policy);
    event DecisionTopicUpdated(uint64 previousTopicNum, uint64 newTopicNum);
    event TokenConfigured(
        address indexed token, address indexed chainlinkFeed, uint32 supraPairId, bool supraEnabled, uint8 decimals
    );
    event TokenRemoved(address indexed token);
    event TokenAssociated(address indexed token);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    /// @notice `tokenA` and `tokenB` are in the order the owner passed them; the approval applies to both directions.
    event PoolFeeSet(address indexed tokenA, address indexed tokenB, uint24 fee);

    error NotAgent(address caller);
    error ZeroAddress();
    error TokenNotAllowed(address token);
    error InvalidPair();
    error ZeroAmount();
    error InvalidPolicy();
    error UnsupportedDecimals(uint8 decimals);
    error NoPriceSource();
    error DecisionTopicNotSet();
    error ReasoningRequired();
    error ReasoningOutOfOrder(uint64 sequence, uint64 lastSequence);
    error TradeTooLarge(uint256 usdValue, uint256 maxTradeUsd);
    error DailyCapExceeded(uint256 usdValue, uint256 remainingUsd);
    error CooldownActive(uint256 readyAt);
    error InvalidOraclePrice(address token);
    error StalePrice(address token, uint256 updatedAt, uint256 maxAge);
    error OracleDivergence(address token, uint256 divergenceBps, uint256 maxDivergenceBps);
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);
    error HtsAssociationFailed(address token, int256 responseCode);
    /// @notice Renouncing would leave no account able to withdraw, locking the vault's tokens forever.
    error OwnershipCannotBeRenounced();
    /// @notice The request's fee tier is not the one the owner approved for the pair, or the pair has none.
    error PoolFeeNotAllowed(uint24 fee);

    // ---------------------------------------------------------------- agent

    /// @notice Prices both legs from the oracles (Chainlink confirmed by Supra, or Supra alone for a token without a
    ///         Chainlink feed), enforces the policy, derives the minimum output from those prices and swaps on
    ///         SaucerSwap V2 in the pair's approved fee tier. The output always stays in the vault.
    /// @dev Only the agent. `reasoning.sequence` must be strictly greater than the sequence used by the previous trade.
    function executeSwap(SwapRequest calldata request, Reasoning calldata reasoning)
        external
        returns (uint256 amountOut);

    // ---------------------------------------------------------------- views

    /// @notice Prices `request` exactly as `executeSwap` would, without the policy, cooldown or staleness checks.
    /// @dev Reverts only if a token is not allowed or an oracle returns a non-positive price.
    function quote(SwapRequest calldata request) external view returns (Quote memory);

    /// @notice Reads one token's oracles without enforcing staleness or divergence. Useful for dashboards.
    function oracleReading(address token) external view returns (OracleReading memory);

    /// @notice SaucerSwap V2 SwapRouter that executes every trade; fixed at deployment.
    function ROUTER() external view returns (ISaucerSwapV2SwapRouter);
    /// @notice Supra push oracle the vault reads; fixed at deployment.
    function SUPRA() external view returns (ISupraSValueFeed);
    function agent() external view returns (address);
    function policy() external view returns (Policy memory);
    function tokenConfig(address token) external view returns (TokenConfig memory);
    /// @notice Every currently allowed token, in configuration order.
    function allowedTokens() external view returns (address[] memory);
    function hcsTopicNum() external view returns (uint64);
    function lastTradeAt() external view returns (uint256);
    function lastReasoningSequence() external view returns (uint64);
    function tradeCount() external view returns (uint256);
    function spentUsdOn(uint256 day) external view returns (uint256);
    function remainingDailyUsd() external view returns (uint256);
    function nextTradeAt() external view returns (uint256);
    /// @notice Fee tier the owner approved for the pair, in either order; 0 when the pair may not be traded.
    function poolFee(address tokenA, address tokenB) external view returns (uint24);

    // ---------------------------------------------------------------- owner

    function setAgent(address newAgent) external;
    function setPolicy(Policy calldata newPolicy) external;
    function setDecisionTopic(uint64 topicNum) external;
    /// @notice Allows `token`. Chainlink `chainlinkFeed` prices it and Supra pair `supraPairId` cross-checks it; pass
    ///         address(0) as the feed to price it with Supra alone. Reads decimals from the token.
    function configureToken(address token, address chainlinkFeed, uint32 supraPairId, bool supraEnabled) external;
    function removeToken(address token) external;
    /// @notice Approves SaucerSwap fee tier `fee` for swaps between `tokenA` and `tokenB`, in both directions. A fee of
    ///         0 disallows the pair. Without it the agent could route every trade through whichever pool of
    ///         the pair it likes, such as a high-fee or thin one that fills just above the oracle-derived minimum.
    function setPoolFee(address tokenA, address tokenB, uint24 fee) external;
    /// @notice Associates the vault with an HTS token so it can hold it. Required on Hedera before receiving a token.
    function associateToken(address token) external;
    function pause() external;
    function unpause() external;
    /// @notice Moves tokens out of the vault. Owner only, works while paused. The agent has no withdrawal path.
    function withdraw(address token, uint256 amount, address to) external;
}
