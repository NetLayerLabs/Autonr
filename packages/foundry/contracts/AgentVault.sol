// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IAgentVault } from "./interfaces/IAgentVault.sol";
import { IAggregatorV3 } from "./interfaces/IAggregatorV3.sol";
import { IHederaTokenService } from "./interfaces/IHederaTokenService.sol";
import { ISaucerSwapV2SwapRouter } from "./interfaces/ISaucerSwapV2SwapRouter.sol";
import { ISupraSValueFeed } from "./interfaces/ISupraSValueFeed.sol";
import { OracleMath } from "./libraries/OracleMath.sol";

/// @title AgentVault
/// @notice Holds tokens for an off-chain agent and lets it swap them on SaucerSwap V2 only at oracle-derived prices,
///         within an owner-set policy, and only against reasoning it published to HCS beforehand.
/// @dev The owner configures, funds and drains the vault. The agent can only call `executeSwap`; it never supplies a
///      price or a minimum output, and every swap pays out to the vault itself.
contract AgentVault is IAgentVault, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address private constant HTS = address(0x167);
    int64 private constant HTS_SUCCESS = 22;
    int64 private constant HTS_TOKEN_ALREADY_ASSOCIATED = 194;
    /// @dev Hedera's own HTS helpers report a call that returned no response code as UNKNOWN (21); so does the vault.
    int64 private constant HTS_UNKNOWN = 21;

    /// @dev Supra's push oracle reports update times in milliseconds on Hedera. A value above 1e12 is a millisecond
    ///      timestamp (1e12 ms is September 2001, while 1e12 s is thousands of years away).
    uint256 private constant SUPRA_MILLISECONDS_THRESHOLD = 1e12;

    /// @dev USD math scales by 10**decimals; beyond 18 decimals a token is not a real HTS or ERC-20 asset anyway.
    uint8 private constant MAX_TOKEN_DECIMALS = 18;
    /// @dev Oracles on Hedera update every few minutes at best, so a tighter bound would refuse every trade; a price
    ///      older than a day no longer describes the market.
    uint32 private constant MIN_PRICE_AGE = 60;
    uint32 private constant MAX_PRICE_AGE = 1 days;
    /// @dev Past 50% slippage or oracle disagreement the price guard no longer protects anything.
    uint16 private constant MAX_POLICY_BPS = 5_000;

    /// @inheritdoc IAgentVault
    ISaucerSwapV2SwapRouter public immutable ROUTER;
    /// @inheritdoc IAgentVault
    /// @dev Cross-checks Chainlink, or prices tokens that have no Chainlink feed.
    ISupraSValueFeed public immutable SUPRA;

    /// @notice The only account allowed to call `executeSwap`.
    address public agent;
    /// @notice Number N of the HCS decision topic 0.0.N. Zero disables trading.
    uint64 public hcsTopicNum;
    /// @notice Timestamp of the latest trade, or 0 before the first one.
    uint256 public lastTradeAt;
    /// @notice Number of executed trades, which is also the id of the latest one.
    uint256 public tradeCount;
    /// @notice USD notional (E18) traded on a UTC day, keyed by `timestamp / 1 days`.
    mapping(uint256 day => uint256 usdValue) public spentUsdOn;

    Policy private _policy;
    mapping(address token => TokenConfig config) private _tokenConfigs;
    address[] private _allowedTokens;
    /// @dev HCS sequence numbers restart on every topic, so ordering is tracked per topic: a new topic starts from
    ///      zero, and switching back to an old topic cannot reuse a sequence number that already backed a trade.
    mapping(uint64 topicNum => uint64 sequence) private _lastSequenceByTopic;
    mapping(bytes32 pairKey => uint24 fee) private _poolFees;

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent(msg.sender);
        _;
    }

    /// @param initialOwner Configures the vault and is the only account that can withdraw from it.
    /// @param router SaucerSwap V2 SwapRouter.
    /// @param supra Supra push oracle.
    /// @param initialAgent Account allowed to call `executeSwap`.
    /// @param topicNum N of the HCS decision topic 0.0.N, or 0 to keep trading disabled until it is set.
    /// @param initialPolicy Risk policy, validated as in `setPolicy`.
    constructor(
        address initialOwner,
        address router,
        address supra,
        address initialAgent,
        uint64 topicNum,
        Policy memory initialPolicy
    ) Ownable(initialOwner) {
        if (router == address(0) || supra == address(0)) revert ZeroAddress();
        ROUTER = ISaucerSwapV2SwapRouter(router);
        SUPRA = ISupraSValueFeed(supra);
        _setAgent(initialAgent);
        _setDecisionTopic(topicNum);
        _setPolicy(initialPolicy);
    }

    // ---------------------------------------------------------------- agent

    /// @inheritdoc IAgentVault
    /// @dev Rules are checked in a fixed order so a refusal always names the first one broken: caller, reasoning,
    ///      request (amount, pair, tokens, fee tier), cooldown, oracles (tokenIn, then tokenOut), policy limits. State
    ///      is updated before the router is called, and the router can pull at most `amountIn`.
    function executeSwap(SwapRequest calldata request, Reasoning calldata reasoning)
        external
        onlyAgent
        whenNotPaused
        nonReentrant
        returns (uint256 amountOut)
    {
        uint64 topicNum = _requireOrderedReasoning(reasoning);
        (TokenConfig memory configIn, TokenConfig memory configOut) = _requireTradableRequest(request);
        uint256 readyAt = nextTradeAt();
        if (block.timestamp < readyAt) revert CooldownActive(readyAt);

        Quote memory priced = _quote(request, configIn, configOut, true);
        _requireWithinPolicy(priced);

        uint256 tradeId = ++tradeCount;
        lastTradeAt = block.timestamp;
        _lastSequenceByTopic[topicNum] = reasoning.sequence;
        spentUsdOn[_today()] += priced.usdValue;

        uint256 amountIn;
        (amountIn, amountOut) = _swap(request, priced.minAmountOut);
        uint256 usdValue = priced.usdValue;
        if (amountIn != request.amountIn) {
            // Only what the router actually took counts against the daily cap.
            usdValue = OracleMath.usdValue(amountIn, priced.tokenIn.priceE18, configIn.decimals);
            spentUsdOn[_today()] -= priced.usdValue - usdValue;
        }
        _emitTradeExecuted(
            tradeId,
            request,
            TradeReceipt({
                amountIn: amountIn,
                amountOut: amountOut,
                minAmountOut: priced.minAmountOut,
                usdValue: usdValue,
                oracleIn: priced.tokenIn,
                oracleOut: priced.tokenOut,
                reasoningHash: reasoning.hash,
                hcsTopicNum: topicNum,
                hcsSequence: reasoning.sequence
            })
        );
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IAgentVault
    function quote(SwapRequest calldata request) external view returns (Quote memory) {
        return _quote(request, _allowedConfig(request.tokenIn), _allowedConfig(request.tokenOut), false);
    }

    /// @inheritdoc IAgentVault
    /// @dev Reverts with `TokenNotAllowed` for a token that is not configured, and with `InvalidOraclePrice` when an
    ///      oracle reports a non-positive price.
    function oracleReading(address token) external view returns (OracleReading memory) {
        return _readOracles(token, _allowedConfig(token), false);
    }

    /// @notice The risk policy every trade is checked against.
    function policy() external view returns (Policy memory) {
        return _policy;
    }

    /// @notice How `token` is priced; all zeros for a token that was never configured or has been removed.
    function tokenConfig(address token) external view returns (TokenConfig memory) {
        return _tokenConfigs[token];
    }

    /// @inheritdoc IAgentVault
    function allowedTokens() external view returns (address[] memory) {
        return _allowedTokens;
    }

    /// @notice Sequence number of the HCS message behind the latest trade on the current decision topic.
    function lastReasoningSequence() external view returns (uint64) {
        return _lastSequenceByTopic[hcsTopicNum];
    }

    /// @notice USD notional (E18) the agent can still trade today. Zero when a lowered cap is already used up.
    function remainingDailyUsd() public view returns (uint256) {
        uint256 spent = spentUsdOn[_today()];
        uint256 cap = _policy.dailyCapUsd;
        return spent >= cap ? 0 : cap - spent;
    }

    /// @inheritdoc IAgentVault
    function poolFee(address tokenA, address tokenB) external view returns (uint24) {
        return _poolFees[_pairKey(tokenA, tokenB)];
    }

    /// @notice Earliest timestamp of the next trade, or 0 before the first trade.
    function nextTradeAt() public view returns (uint256) {
        uint256 last = lastTradeAt;
        return last == 0 ? 0 : last + _policy.cooldown;
    }

    // ---------------------------------------------------------------- owner

    /// @notice Replaces the agent. The previous agent loses access immediately.
    function setAgent(address newAgent) external onlyOwner {
        _setAgent(newAgent);
    }

    /// @notice Replaces the risk policy. Applies from the next trade; today's spending counts against the new cap.
    function setPolicy(Policy calldata newPolicy) external onlyOwner {
        _setPolicy(newPolicy);
    }

    /// @notice Points the vault at HCS topic 0.0.`topicNum`. Zero disables trading.
    function setDecisionTopic(uint64 topicNum) external onlyOwner {
        _setDecisionTopic(topicNum);
    }

    /// @inheritdoc IAgentVault
    /// @dev Re-configuring an allowed token updates it in place and keeps its position in `allowedTokens`.
    function configureToken(address token, address chainlinkFeed, uint32 supraPairId, bool supraEnabled)
        external
        onlyOwner
    {
        if (token == address(0)) revert ZeroAddress();
        if (chainlinkFeed == address(0) && !supraEnabled) revert NoPriceSource();
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals > MAX_TOKEN_DECIMALS) revert UnsupportedDecimals(decimals);

        if (!_tokenConfigs[token].allowed) _allowedTokens.push(token);
        _tokenConfigs[token] = TokenConfig({
            allowed: true,
            decimals: decimals,
            chainlinkFeed: chainlinkFeed,
            supraPairId: supraPairId,
            supraEnabled: supraEnabled
        });
        emit TokenConfigured(token, chainlinkFeed, supraPairId, supraEnabled, decimals);
    }

    /// @notice Disallows `token` and forgets its oracle configuration. Balances stay in the vault until withdrawn.
    function removeToken(address token) external onlyOwner {
        if (!_tokenConfigs[token].allowed) revert TokenNotAllowed(token);
        delete _tokenConfigs[token];
        _removeFromAllowedTokens(token);
        emit TokenRemoved(token);
    }

    /// @inheritdoc IAgentVault
    /// @dev Independent of `configureToken`: a pair still needs both tokens allowed to trade, and removing a token
    ///      leaves its approved fee tiers in place for when it is allowed again.
    function setPoolFee(address tokenA, address tokenB, uint24 fee) external onlyOwner {
        if (tokenA == address(0) || tokenB == address(0)) revert ZeroAddress();
        if (tokenA == tokenB) revert InvalidPair();
        _poolFees[_pairKey(tokenA, tokenB)] = fee;
        emit PoolFeeSet(tokenA, tokenB, fee);
    }

    /// @inheritdoc IAgentVault
    /// @dev Idempotent: an existing association counts as success. On Hedera the association fee is charged as gas
    ///      (roughly 0.7M per token), so send this with an explicit gas limit rather than an estimate.
    function associateToken(address token) external onlyOwner {
        (bool success, bytes memory result) =
            HTS.call(abi.encodeCall(IHederaTokenService.associateToken, (address(this), token)));
        int64 responseCode = success && result.length >= 32 ? abi.decode(result, (int64)) : HTS_UNKNOWN;
        if (responseCode != HTS_SUCCESS && responseCode != HTS_TOKEN_ALREADY_ASSOCIATED) {
            revert HtsAssociationFailed(token, responseCode);
        }
        emit TokenAssociated(token);
    }

    /// @notice Stops trading. Withdrawals keep working.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes trading.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @inheritdoc IAgentVault
    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    /// @notice Always reverts: see `OwnershipCannotBeRenounced`. Ownership can still be transferred in two steps.
    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    // ---------------------------------------------------------------- internals

    function _requireOrderedReasoning(Reasoning calldata reasoning) private view returns (uint64 topicNum) {
        if (reasoning.hash == bytes32(0)) revert ReasoningRequired();
        topicNum = hcsTopicNum;
        if (topicNum == 0) revert DecisionTopicNotSet();
        uint64 lastSequence = _lastSequenceByTopic[topicNum];
        if (reasoning.sequence <= lastSequence) revert ReasoningOutOfOrder(reasoning.sequence, lastSequence);
    }

    function _requireTradableRequest(SwapRequest calldata request)
        private
        view
        returns (TokenConfig memory configIn, TokenConfig memory configOut)
    {
        if (request.amountIn == 0) revert ZeroAmount();
        if (request.tokenIn == request.tokenOut) revert InvalidPair();
        configIn = _allowedConfig(request.tokenIn);
        configOut = _allowedConfig(request.tokenOut);
        uint24 approvedFee = _poolFees[_pairKey(request.tokenIn, request.tokenOut)];
        if (approvedFee == 0 || request.poolFee != approvedFee) revert PoolFeeNotAllowed(request.poolFee);
    }

    function _requireWithinPolicy(Quote memory priced) private view {
        if (priced.minAmountOut == 0) revert ZeroAmount();
        uint256 maxTradeUsd = _policy.maxTradeUsd;
        if (priced.usdValue > maxTradeUsd) revert TradeTooLarge(priced.usdValue, maxTradeUsd);
        uint256 remaining = remainingDailyUsd();
        if (priced.usdValue > remaining) revert DailyCapExceeded(priced.usdValue, remaining);
    }

    /// @param enforce Whether stale or diverging oracles revert (trading) or are only reported (views).
    function _quote(
        SwapRequest calldata request,
        TokenConfig memory configIn,
        TokenConfig memory configOut,
        bool enforce
    ) private view returns (Quote memory priced) {
        priced.tokenIn = _readOracles(request.tokenIn, configIn, enforce);
        priced.tokenOut = _readOracles(request.tokenOut, configOut, enforce);
        priced.usdValue = OracleMath.usdValue(request.amountIn, priced.tokenIn.priceE18, configIn.decimals);
        priced.expectedOut = OracleMath.expectedOut(priced.usdValue, priced.tokenOut.priceE18, configOut.decimals);
        priced.minAmountOut = OracleMath.minAmountOut(priced.expectedOut, _policy.maxSlippageBps);
    }

    /// @dev Chainlink prices the token when it has a feed and Supra must then agree with it; otherwise Supra alone
    ///      prices it. Each source is validated, then checked for staleness, before the next one is read.
    function _readOracles(address token, TokenConfig memory config, bool enforce)
        private
        view
        returns (OracleReading memory reading)
    {
        uint256 maxAge = _policy.maxPriceAge;
        bool hasChainlink = config.chainlinkFeed != address(0);
        if (hasChainlink) {
            (reading.priceE18, reading.updatedAt) = _readChainlink(token, config.chainlinkFeed);
            if (enforce) _requireFresh(token, reading.updatedAt, maxAge);
        }
        if (!config.supraEnabled) return reading;

        (uint256 supraE18, uint256 supraUpdatedAt) = _readSupra(token, config.supraPairId);
        if (enforce) _requireFresh(token, supraUpdatedAt, maxAge);
        if (!hasChainlink) {
            (reading.priceE18, reading.updatedAt) = (supraE18, supraUpdatedAt);
            return reading;
        }

        reading.crossCheckE18 = supraE18;
        reading.crossCheckUpdatedAt = supraUpdatedAt;
        reading.divergenceBps = OracleMath.divergenceBps(reading.priceE18, supraE18);
        uint256 maxDivergence = _policy.maxOracleDivergenceBps;
        if (enforce && reading.divergenceBps > maxDivergence) {
            revert OracleDivergence(token, reading.divergenceBps, maxDivergence);
        }
    }

    function _readChainlink(address token, address feed) private view returns (uint256 priceE18, uint256 updatedAt) {
        IAggregatorV3 aggregator = IAggregatorV3(feed);
        int256 answer;
        (, answer,, updatedAt,) = aggregator.latestRoundData();
        // Only a positive answer is cast. It can still normalize to zero if the feed carries more than 18 decimals.
        // forge-lint: disable-next-line(unsafe-typecast)
        priceE18 = answer > 0 ? OracleMath.normalize(uint256(answer), aggregator.decimals()) : 0;
        if (priceE18 == 0 || updatedAt == 0) revert InvalidOraclePrice(token);
    }

    function _readSupra(address token, uint32 pairId) private view returns (uint256 priceE18, uint256 updatedAt) {
        ISupraSValueFeed.PriceFeed memory feed = SUPRA.getSvalue(pairId);
        priceE18 = OracleMath.normalize(feed.price, feed.decimals);
        if (priceE18 == 0) revert InvalidOraclePrice(token);
        updatedAt = feed.time > SUPRA_MILLISECONDS_THRESHOLD ? feed.time / 1000 : feed.time;
    }

    function _requireFresh(address token, uint256 updatedAt, uint256 maxAge) private view {
        // Adding instead of subtracting: an oracle clock slightly ahead of the block must not underflow.
        if (updatedAt + maxAge < block.timestamp) revert StalePrice(token, updatedAt, maxAge);
    }

    /// @dev Approves exactly `amountIn` and measures what actually left and arrived instead of trusting the router's
    ///      return value, so a faulty router can neither take more than the request nor pay less than the minimum.
    function _swap(SwapRequest calldata request, uint256 minAmountOut)
        private
        returns (uint256 amountIn, uint256 amountOut)
    {
        IERC20 tokenIn = IERC20(request.tokenIn);
        IERC20 tokenOut = IERC20(request.tokenOut);
        uint256 inBefore = tokenIn.balanceOf(address(this));
        uint256 outBefore = tokenOut.balanceOf(address(this));

        tokenIn.forceApprove(address(ROUTER), request.amountIn);
        ROUTER.exactInput(
            ISaucerSwapV2SwapRouter.ExactInputParams({
                path: abi.encodePacked(request.tokenIn, request.poolFee, request.tokenOut),
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: request.amountIn,
                amountOutMinimum: minAmountOut
            })
        );

        amountIn = inBefore - tokenIn.balanceOf(address(this));
        amountOut = tokenOut.balanceOf(address(this)) - outBefore;
        if (amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);
        // A pool that runs out of liquidity fills only part of the input and leaves allowance behind.
        if (tokenIn.allowance(address(this), address(ROUTER)) != 0) tokenIn.forceApprove(address(ROUTER), 0);
    }

    function _emitTradeExecuted(uint256 tradeId, SwapRequest calldata request, TradeReceipt memory receipt) private {
        emit TradeExecuted(tradeId, request.tokenIn, request.tokenOut, receipt);
    }

    function _allowedConfig(address token) private view returns (TokenConfig memory config) {
        config = _tokenConfigs[token];
        if (!config.allowed) revert TokenNotAllowed(token);
    }

    /// @dev Shifts later tokens left so `allowedTokens` keeps configuration order; the list holds a handful of tokens.
    function _removeFromAllowedTokens(address token) private {
        uint256 last = _allowedTokens.length - 1;
        uint256 index;
        while (_allowedTokens[index] != token) ++index;
        for (; index < last; ++index) {
            _allowedTokens[index] = _allowedTokens[index + 1];
        }
        _allowedTokens.pop();
    }

    function _setAgent(address newAgent) private {
        if (newAgent == address(0)) revert ZeroAddress();
        emit AgentUpdated(agent, newAgent);
        agent = newAgent;
    }

    function _setDecisionTopic(uint64 topicNum) private {
        emit DecisionTopicUpdated(hcsTopicNum, topicNum);
        hcsTopicNum = topicNum;
    }

    function _setPolicy(Policy memory newPolicy) private {
        if (
            newPolicy.maxTradeUsd == 0 || newPolicy.dailyCapUsd < newPolicy.maxTradeUsd
                || newPolicy.maxPriceAge < MIN_PRICE_AGE || newPolicy.maxPriceAge > MAX_PRICE_AGE
                || newPolicy.maxSlippageBps == 0 || newPolicy.maxSlippageBps > MAX_POLICY_BPS
                || newPolicy.maxOracleDivergenceBps == 0 || newPolicy.maxOracleDivergenceBps > MAX_POLICY_BPS
        ) revert InvalidPolicy();
        _policy = newPolicy;
        emit PolicyUpdated(newPolicy);
    }

    /// @dev Order-independent, so one approval covers both swap directions of a pair.
    function _pairKey(address tokenA, address tokenB) private pure returns (bytes32) {
        return tokenA < tokenB ? keccak256(abi.encode(tokenA, tokenB)) : keccak256(abi.encode(tokenB, tokenA));
    }

    function _today() private view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
