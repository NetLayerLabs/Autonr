# Threat model

Assume the agent, including any LLM behind it, may be wrong, manipulated or compromised. The owner's key is trusted.
Each row names the mitigation and the tests that cover it. Foundry tests live in `packages/foundry/test`
(`AgentVault.t.sol` unless noted). Vitest tests live in `packages/agent/test`.

Run them with `yarn foundry:test`, `yarn foundry:test:fork` and `yarn agent:test`.

## The agent trades badly or maliciously

| Threat | Mitigation | Covered by |
| ------ | ---------- | ---------- |
| The agent (or a hallucinating LLM) accepts a terrible price | The agent cannot pass a minimum output. The vault derives `amountOutMinimum` from Chainlink and Supra, passes it to the router and measures the balance it actually received. | `test_executeSwap_sellsAtTheOracleDerivedMinimum`, `test_executeSwap_buysAtTheOracleDerivedMinimum`, `test_executeSwap_acceptsOutputExactlyAtTheMinimum`, `test_executeSwap_routerRefusesOutputBelowTheMinimum`, `testFuzz_executeSwap_neverAcceptsLessThanTheMinimum`. Fork: `test_buyFromTheMispricedPoolIsRefused`, `test_sellsWhbarForUsdcAtTheOracleDerivedMinimum` |
| A router or pool pays less than it promised | The vault measures the output token's balance delta and reverts `InsufficientOutput`, even if the router ignores `amountOutMinimum`. | `test_executeSwap_revertsWhenARouterIgnoresTheMinimum` (`UnderpayingRouter`) |
| The agent drains the vault through many or large trades | Per-trade cap, UTC daily cap and cooldown, all enforced on-chain. | `test_executeSwap_tradeSizeBoundary`, `test_executeSwap_dailyCapResetsAtUtcMidnight`, `test_executeSwap_loweredCapBelowTodaysSpendingStopsTrading`, `test_executeSwap_enforcesTheCooldownBoundary`, `invariant_dailySpendingNeverExceedsTheCap` (`AgentVault.invariant.t.sol`). Live: red-team `oversize` |
| The agent sends funds elsewhere | The swap recipient is always the vault. The agent has no withdrawal path, and only the owner can call `withdraw`. | `invariant_theAgentCanNeverWithdraw`, `invariant_tokensMoveOnlyThroughTheRouterOrOwnerWithdrawals`, `test_ownerFunctions_revertForAgentAndStrangers` |
| The agent trades into a worthless or malicious token | Owner-managed allow-list, checked for both legs (tokenIn first). | `test_executeSwap_revertsOnUnlistedTokenOut`, `test_executeSwap_reportsTokenInFirstWhenNeitherTokenIsAllowed`, `test_executeSwap_revertsForRemovedToken_beforeCooldown`, `test_quote_revertsForUnlistedTokens`. Live: red-team `unlisted-token`. Agent: `red-team.test.ts` "sends an unlisted token that is neither leg of the pair, the same one on every run" |
| A trade too small to price slips through with a zero minimum | `minAmountOut == 0` reverts `ZeroAmount`. | `test_executeSwap_rejectsTradesTooSmallToPrice` |
| Someone other than the agent calls `executeSwap` | `onlyAgent` is the first check. | `test_executeSwap_revertsForNonAgent`, `test_executeSwap_checksCallerBeforePause`. Live: red-team `not-agent` |
| The agent's key is stolen | Losses are bounded by the caps. The owner can `pause` (withdrawals keep working) and `setAgent` to a new key. | `test_pause_blocksTradingButNotWithdrawals`, `test_setAgent_movesTradingRightsToTheNewAgent` |
| An LLM returns malformed output, is prompt-injected, or proposes more than the vault holds | The answer is validated with zod. Any failure becomes a hold. The agent refuses to sell more than the balance, and the vault still applies every cap and its own price. | `llm.test.ts`: "holds when the model cannot be reached", "holds instead of selling more than the vault has", "turns a valid answer into a trade and records the model that gave it" |
| A leaked agent key routes trades through a thin or attacker-controlled pool | The owner approves one fee tier per pair (`setPoolFee`); any other tier reverts `PoolFeeNotAllowed` before the swap. The oracle-derived minimum still bounds every fill. | `test_setPoolFee_zeroDisallowsThePair`, `test_executeSwap_revertsOnUnapprovedPoolFee_beforeCooldown`, `test_executeSwap_checksAllowListBeforePoolFee`; red-team `unapproved-fee` |

## Oracle failures

| Threat | Mitigation | Covered by |
| ------ | ---------- | ---------- |
| A stale price (feed stopped updating) | `updatedAt + maxPriceAge < block.timestamp` reverts `StalePrice`, for Chainlink and for Supra (milliseconds converted). The agent holds 30 s before the limit. | `test_executeSwap_chainlinkStalenessBoundary`, `test_executeSwap_supraStalenessBoundaryInMilliseconds`, `test_executeSwap_acceptsSupraTimestampsInSeconds`, `test_executeSwap_toleratesOracleClocksAheadOfTheBlock`. Agent: `oracle-math.test.ts` "converts Supra's millisecond timestamps to seconds and leaves seconds alone" |
| One oracle network is manipulated or wrong | Chainlink prices, and Supra must agree within `maxOracleDivergenceBps`, measured against Chainlink. | `test_executeSwap_divergenceBoundaryAboveAndBelowChainlink`, `test_executeSwap_checksSupraFreshnessBeforeDivergence`. Agent: `oracle-math.test.ts` "measures divergence against the primary price, whichever side is higher" |
| An oracle returns zero, a negative answer or an empty round | `InvalidOraclePrice` for non-positive answers, a Chainlink round without a timestamp, a zero Supra price, or a price that normalises to zero. | `test_executeSwap_rejectsNonPositiveChainlinkAnswers`, `test_executeSwap_rejectsChainlinkRoundWithoutTimestamp`, `test_executeSwap_rejectsZeroSupraCrossCheck`, `test_executeSwap_rejectsAZeroSupraOnlyPrice`, `test_quote_revertsOnNonPositivePrices` |
| A math mismatch between what the agent expects and what the vault enforces | One shared vector file, checked by both suites. Fuzzed properties. | `OracleMath.t.sol`: `test_matchesSharedVectors`, `testFuzz_minAmountOutNeverExceedsExpectedOut`, `testFuzz_expectedOutNeverOverpays`, `testFuzz_normalizeIsMonotonic`, `testFuzz_normalizeIsLosslessUpTo18Decimals`. Agent: `oracle-math.test.ts` "parity with the Solidity vectors" |
| Wrong addresses between the deploy script and the agent | A test reads `networks.ts` and fails on any mismatch with `HelperConfig.s.sol`. | `HelperConfig.t.sol`: `test_hederaConfigMatchesTheAgentNetworks` |

## The decision log lies

| Threat | Mitigation | Covered by |
| ------ | ---------- | ---------- |
| Trading without published reasoning | The vault requires a non-zero reasoning hash and a decision topic. The agent publishes and waits for consensus before it signs the trade. | `test_executeSwap_revertsWithoutReasoningHash_beforeTopicCheck`, `test_setDecisionTopic_zeroDisablesTrading`, `test_executeSwap_checksTopicBeforeSequence`. Live: red-team `no-reasoning`. Agent: `tick.test.ts` "publishes the reasoning, then trades citing its hash and sequence" |
| Writing the reasoning after the trade | The verifier's `ordering` check needs the message's consensus timestamp strictly before the trade's. | `verify-trade.test.ts` "fails ordering for a message published a single nanosecond after the trade" |
| One message backing several trades | The sequence must be strictly greater than the last one on the current topic, tracked per topic. | `test_executeSwap_requiresStrictlyIncreasingSequences`, `test_reasoningSequence_isTrackedPerTopic`, `invariant_reasoningSequenceStrictlyIncreasesWithEveryTrade`. Live: red-team `replayed-reasoning` |
| Publishing one rationale and executing another | `hash-match` re-hashes the exact message bytes. `content-match` compares the record's network, vault, tokens, `amountIn` and fee tier with the executed trade. | `verify-trade.test.ts` "fails hash-match when one byte of the message changes", "fails content-match when the published record differs from the executed trade", "fails only content-match when the receipt's amountIn is changed", "fails content-match on another fee tier and warns when the fee tier is unknown" |
| Someone else writes to the log, or the agent hides behind another account | The topic's submit key is the agent's ECDSA key. `same-key` requires that key's address to be `vault.agent()` and the trade's sender, and requires the agent to pay for the message. The audit flags foreign payers and open topics. | `verify-trade.test.ts` "fails same-key when the topic's submit key is not the agent's key", "fails same-key when another account paid for the message", "fails same-key without a submit key, with a non-ECDSA key, or with another sender". `audit.test.ts` "flags a topic anyone can write to, or one keyed to someone else" |
| Trades that never appear in the log, or decisions that silently vanish | The audit maps every `TradeExecuted` to one earlier `trade` record, and requires every `trade` record to end in a trade or an execution-stage rejection. The tick publishes that rejection when a trade reverts. | `audit.test.ts` "finds an unbacked trade, a trade decision without outcome, invalid messages and foreign payers", "rejects a trade executed before its decision was published, or with another hash". `tick.test.ts` "follows a reverted trade with a rejection that points at the trade record" |
| The agent claims "the vault refused" when it never asked | Simulation rejections carry replay data. Anyone can re-run the call at that block and compare the error. | `replay.test.ts` "reproduces the recorded custom error from the same sender at the same block", "reports a different error as not reproduced", "reports a call that now succeeds as not reproduced". `tick.test.ts` "publishes a replayable rejection when the vault refuses the simulation" |
| A receipt with invented oracle readings, or a swap that skipped the oracles | `oracle-match` re-reads Chainlink and Supra at the trade's block. `atomic-trace` requires the vault to read every configured oracle before `exactInput`, in the same transaction, through the SaucerSwap router. | `verify-trade.test.ts` "fails when the oracle on chain disagrees with the receipt at the same update time", "fails when the vault swapped without reading one of the configured oracles", "fails when an oracle is read only after the swap", "fails when the swap did not go through the SaucerSwap router" |
| Malformed or hostile messages break the verifier or the dashboard | Messages are decoded without throwing, and invalid ones are flagged, never dropped. Malformed evidence is a failure, not a crash. | `listings.test.ts` "decodes valid records and flags invalid ones instead of dropping them". `verify-trade.test.ts` "treats malformed base64 in edited evidence as a failure, not a crash" |
| Mirror Node lag is presented as a failed proof | Missing data is a `skip` and an `incomplete` verdict. | `verify-trade.test.ts` "returns an incomplete verdict, never a failure, while state and the trace are unavailable", "skips, rather than fails, when an oracle updated again later in the same block" |
| Someone deploys a lookalike contract that emits a `TradeExecuted`-shaped event and cites their own HCS message | The verifier's `vault-code` check compares the emitter's runtime bytecode with the compiled AgentVault (immutables masked) and requires `ROUTER()`/`SUPRA()` to be the network's router and oracle. | verifier tests for a lookalike contract and a mis-wired router in `packages/agent/test/verify/verify-trade.test.ts`; Tamper lab "Emit from a lookalike contract" |

## Contract-level attacks

| Threat | Mitigation | Covered by |
| ------ | ---------- | ---------- |
| A reentrant router | `nonReentrant` on `executeSwap`. | `test_executeSwap_blocksReentryFromTheRouter` (`ReentrantRouter`) |
| A leftover allowance a router could pull later | The vault approves exactly `amountIn` and resets any remainder to 0. | `test_executeSwap_leavesNoRouterAllowance`, `test_executeSwap_clearsAllowanceLeftByAPartialFill` |
| A check-order change that alters which error a refusal reports (and breaks replay) | The order is fixed, with tests that break two rules at once. | `test_executeSwap_checksPauseBeforeReasoning`, `test_executeSwap_checksSequenceBeforeAmount`, `test_executeSwap_revertsOnZeroAmount_beforePairCheck`, `test_executeSwap_revertsOnSameToken_beforeAllowListCheck`, `test_executeSwap_checksCooldownBeforeOracles`, `test_executeSwap_checksTokenInOraclesBeforeTokenOut`, `test_executeSwap_checksChainlinkFreshnessBeforeSupraValidity`, `test_executeSwap_checksSupraValidityBeforeItsFreshness`, `test_executeSwap_checksOraclesBeforePolicyLimits`, `test_executeSwap_checksTradeSizeBeforeDailyCap` |
| A policy that disables its own protections | `setPolicy` bounds every field (`InvalidPolicy`). | `test_setPolicy_rejectsEveryOutOfRangeField`, `test_setPolicy_acceptsBoundaryValues`, `test_constructor_revertsOnInvalidPolicy` |
| Funds locked by losing the owner | `Ownable2Step` needs the new owner to accept. `renounceOwnership` is disabled. | `test_transferOwnership_takesTwoSteps`, `test_renounceOwnership_isDisabled` |
| An HTS association that silently fails | The response code is checked. Anything except `SUCCESS` and `TOKEN_ALREADY_ASSOCIATED` reverts `HtsAssociationFailed`. | `test_associateToken_revertsWithTheHtsResponseCode`, `test_associateToken_treatsExistingAssociationAsSuccess`, `test_associateToken_reportsUnknownWhenTheSystemContractReverts` |

## Secrets and the dashboard

| Threat | Mitigation | Covered by |
| ------ | ---------- | ---------- |
| Keys leak through logs or error messages | Config errors name the variable and the rule, never the value. API errors redact key, secret and URL values. Keys are read only server-side. | `config.test.ts` "reports invalid values without echoing them", "rejects a key outside the secp256k1 range without quoting it" |
| The env file is readable by other users | `updateEnvFile` creates a missing file readable only by its owner. | `env-file.test.ts` "creates a missing file readable only by its owner, then updates it" |
| Anyone who can reach the dashboard triggers trades | `POST /api/agent/tick` is off by default (`AUTONR_ENABLE_TICK_API`). It takes an optional secret compared in constant time, requires a JSON body (blocking cross-site form posts) and runs one tick at a time. | Checked by hand against a running server (403, 415, 409); there are no automated tests for the Next.js routes. |
| A trade record that the vault would reject is published, wasting the log | The agent checks the vault's preconditions, the pool and an `eth_call` simulation before publishing. | `tick.test.ts` "holds and says why when the SaucerSwap pool is priced away from the oracles", "holds when the vault does not hold enough to sell", "decides and simulates in a dry run, but publishes and sends nothing" |

## Out of scope

- **The owner.** The owner can change the policy, the token list, the agent and the topic, and can withdraw everything.
  Use a multisig or hardware key for real funds. The topic's admin key (the operator) could also change the submit
  key. `same-key` and the audit would then flag every trade as failing, but nothing on-chain prevents it.
- **Both oracle networks wrong in the same direction** within the divergence tolerance.
- **SaucerSwap.** A pool can be thin or mispriced. The vault's minimum bounds the loss to `maxSlippageBps` of the oracle
  price, not to zero.
- **Availability.** Mirror Node, relay and oracle outages stop trading (the agent holds) but do not lose funds.
- **No audit.** The contracts have 100% line and branch coverage, fuzz and invariant tests, and mainnet fork tests, but
  have not had an external audit.
