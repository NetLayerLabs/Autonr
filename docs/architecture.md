# Architecture

Autonr splits an autonomous trader into parts that do not have to trust each other. The agent decides whether to
trade. The vault decides at what price and whether the trade is allowed. HCS records the reasoning before the trade,
and an independent verifier checks the result from public data.

```
                    decides WHETHER                       decides AT WHAT PRICE, enforces policy
  +-------------------------------------+          +------------------------------------------+
  | packages/agent  (TypeScript)        |          | packages/foundry  AgentVault (HSCS)      |
  |  strategy: rebalance | llm | manual | -------> |  Chainlink price, Supra cross-check      |
  |  pool check (SaucerSwap QuoterV2)   | execute  |  caps, cooldown, staleness, divergence   |
  |  eth_call simulation                |  Swap    |  minAmountOut from the oracles           |
  |  HCS publish (@hiero-ledger/sdk)    |          |  SaucerSwap V2 exactInput, output = vault|
  +------------------+------------------+          +---------------------+--------------------+
                     | decision record                                   | TradeExecuted receipt
                     v                                                   v
            +-----------------+                              +-----------------------+
            | HCS topic       |  <---- Mirror Node REST ---->| verifier (agent/verify)|
            | submit key =    |                              | 12 checks, replay,    |
            | agent's key     |                              | audit, Tamper lab     |
            +-----------------+                              +-----------------------+
                                                                         ^
                                     packages/nextjs dashboard ----------+  (reads the same APIs)
```

## Packages

| Package            | Workspace name | Owns                                                                                                            |
| ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/foundry` | `@sh/foundry`  | `AgentVault`, `OracleMath`, minimal interfaces (Chainlink, Supra, SaucerSwap V2 router, HTS), deploy scripts, mocks, unit/fuzz/invariant/fork tests. |
| `packages/agent`   | `@sh/agent`    | The agent runtime (config, oracle reads, strategies, HCS, vault calls, tick, setup, doctor), SaucerSwap tools, the Mirror Node client, the verifier and every CLI. TypeScript sources with no build step: CLIs run through `tsx` and Next.js transpiles the package. |
| `packages/nextjs`  | `@sh/nextjs`   | Dashboard pages, API routes (server-only, calling `@sh/agent`), and the owner console (wallet writes through the scaffold hooks). |

`@sh/agent` exports several entry points so each consumer gets only what it can run:

| Entry                 | Contents                                                                 | Safe in the browser |
| --------------------- | ------------------------------------------------------------------------ | ------------------- |
| `@sh/agent`           | Config, market snapshot, vault state, `runTick`, red team, error decoding | no (server only)    |
| `@sh/agent/verify`    | `verifyTrade`, `fetchTradeEvidence`, listings, replay, audit              | no (does I/O)       |
| `@sh/agent/hak`       | Hedera Agent Kit plugin `autonrPlugin`, `hederaAiSdkTools`                | no (server only)    |
| `@sh/agent/evaluate`  | `evaluateTradeEvidence`, `buildTradeProof`, `TRACE_SELECTORS`             | yes (pure)          |
| `@sh/agent/decision`  | Decision record schema, encode/decode                                    | yes                 |
| `@sh/agent/networks`  | Per-network addresses                                                    | yes                 |
| `@sh/agent/hedera`    | Entity ID, timestamp and HashScan helpers                                | yes                 |
| `@sh/agent/abi`       | `agentVaultAbi`, generated from `IAgentVault.sol`                        | yes                 |

## The vault

`AgentVault` (`packages/foundry/contracts/AgentVault.sol`) implements `IAgentVault`. It inherits OpenZeppelin
`Ownable2Step`, `Pausable` and `ReentrancyGuard`. The SaucerSwap router and the Supra oracle are immutables. Chainlink
feeds are configured per token. It has no payable functions and no `receive`. `renounceOwnership` always reverts,
because only the owner can withdraw.

### Roles

| Role   | Can                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| owner  | `setPolicy`, `setAgent`, `setDecisionTopic`, `configureToken`, `removeToken`, `associateToken`, `pause`, `unpause`, `withdraw` (also while paused), two-step ownership transfer. |
| agent  | `executeSwap` only. The output always goes to the vault.                                                          |
| anyone | Views: `quote`, `oracleReading`, `policy`, `tokenConfig`, `allowedTokens`, `remainingDailyUsd`, `nextTradeAt`, `lastReasoningSequence`, ... |

### `executeSwap` check order

The vault reverts with the first rule it finds broken, always in this order. A refusal is therefore reproducible, and
replay can compare error names exactly.

1. `NotAgent`, `EnforcedPause` (OpenZeppelin), reentrancy guard.
2. `ReasoningRequired` (zero hash), `DecisionTopicNotSet`, `ReasoningOutOfOrder` (sequence not above the last one on
   the current topic).
3. `ZeroAmount`, `InvalidPair` (same token twice), `TokenNotAllowed` (tokenIn first).
4. `CooldownActive`.
5. Oracles for tokenIn, then tokenOut: `InvalidOraclePrice`, `StalePrice`, `OracleDivergence`.
6. `ZeroAmount` (too small to price), `TradeTooLarge`, `DailyCapExceeded`.
7. Effects: trade ID, `lastTradeAt`, the topic's last sequence, today's spend.
8. Approve exactly `amountIn`, call `exactInput` with `recipient = vault` and the vault's own `amountOutMinimum`,
   measure the balance increase (`InsufficientOutput`) and reset any leftover allowance.
9. Emit `TradeExecuted(tradeId, tokenIn, tokenOut, receipt)`. The receipt holds amounts, minimum, USD value, both
   oracle readings per leg and the HCS reference (topic, sequence, hash).

`quote` and `oracleReading` run the same pricing without the staleness, divergence and policy checks. Dashboards and
the agent use them to see what the vault would do.

### Pricing rule

For each token: with a Chainlink feed, Chainlink is the price and Supra (when enabled) must agree within
`maxOracleDivergenceBps`. Without a Chainlink feed, Supra alone is the price. Defaults: WHBAR uses Chainlink HBAR/USD
plus Supra `HBAR_USDT` (pair 75), and USDC uses Supra `USDC_USD` (pair 89).

### Units and math

Solidity (`OracleMath.sol`) and TypeScript (`packages/agent/src/oracles/math.ts`) must agree to the wei. Both test
suites run the same vectors in `packages/foundry/test/vectors/oracle-math.json`.

- USD values and prices are unsigned 18-decimal fixed point ("E18"). Token amounts are raw smallest units.
- `normalize(value, decimals)` scales an oracle answer to E18.
- `divergenceBps = |primary - crossCheck| * 10_000 / primary`.
- `usdValue = mulDiv(amountIn, priceIn, 10^decimalsIn)`,
  `expectedOut = mulDiv(usdValue, 10^decimalsOut, priceOut)`,
  `minAmountOut = expectedOut * (10_000 - maxSlippageBps) / 10_000`.
- Staleness: refuse when `updatedAt + maxPriceAge < block.timestamp`. The check never subtracts, so an oracle clock
  slightly ahead of the block cannot underflow.
- Supra's `time` is in milliseconds on Hedera. Values above `1e12` are divided by 1000.
- Days are UTC (`block.timestamp / 1 days`).

### Policy bounds

`setPolicy` reverts `InvalidPolicy` unless `maxTradeUsd > 0`, `dailyCapUsd >= maxTradeUsd`, `maxPriceAge` is in
60..86,400 s, `maxSlippageBps` is in 1..5,000 and `maxOracleDivergenceBps` is in 1..5,000. The deploy defaults are $25
per trade, $100 per day, a 60 s cooldown, 3% slippage, 1.5% divergence, and a price age of one day on testnet (its feeds
update rarely) or two hours elsewhere.

## The agent tick

`runTick` (`packages/agent/src/agent/tick.ts`) is one cycle. Every outcome is a decision record. A failure that leaves
the outcome unknown throws instead.

1. **Read.** It reads the market snapshot (Chainlink and Supra in one Multicall3 call) and the vault state. If the
   vault's agent or topic does not match the env, it throws `SetupMismatchError` before anything is published.
2. **Vault preconditions.** It holds if the vault is paused, the cooldown is running, any price is within 30 s of
   `maxPriceAge`, or Chainlink and Supra diverge beyond the policy.
3. **Strategy.** `rebalance` (pure and deterministic, the default) keeps the base token near `AUTONR_TARGET_BASE_WEIGHT`
   with a 5% band. `llm` uses the Vercel AI SDK with a zod-validated structured answer, and any failure becomes a hold.
   `manual` comes from `--buy`/`--sell` or the tick API.
4. **Sizing.** The USD amount becomes `amountIn` at the oracle price. The agent holds if that rounds to zero or exceeds
   the vault's balance.
5. **Pool check.** It asks SaucerSwap QuoterV2 what the swap pays, or estimates from the pool's spot price when the
   quoter is unavailable. If that is below the vault's oracle-derived minimum, it holds and says how many bps off the
   pool is.
6. **Simulation.** It runs `eth_call executeSwap` from the agent at a pinned block, with a fixed reasoning hash
   (`keccak256("autonr:simulation")`) and the next sequence. A revert is published as a `rejected` record with
   `replay = { block, from, reasoningHash, sequence }`.
7. **Publish.** The `trade` record goes to HCS, signed by the agent's key, and the tick waits for its consensus record
   (sequence number and timestamp).
8. **Execute.** It sends `executeSwap` with `{ hash: keccak256(record bytes), sequence }`: a legacy transaction, with
   gas set to the estimate plus 30% (capped at 3,000,000). A revert is published as an execution-stage `rejected`
   record whose `decisionSeq` points at the trade record.

Holds are published when `AUTONR_LOG_HOLDS=true`. A dry run publishes and sends nothing.

## The decision record

One record is one HCS message (`packages/agent/src/decision/index.ts`, schema ID `autonr.decision/v1`):

```json
{
  "schema": "autonr.decision/v1",
  "kind": "trade",
  "network": "testnet",
  "vault": "0x…",
  "agent": "0.0.…",
  "createdAt": "2026-10-02T12:00:00.000Z",
  "strategy": { "id": "rebalance", "version": "…" },
  "market": [
    { "feed": "HBAR / USD", "source": "chainlink", "price": "0.1031", "updatedAt": 1790000000, "crossCheck": "0.1029", "divergenceBps": 19 },
    { "feed": "USDC_USD", "source": "supra", "price": "0.99999", "updatedAt": 1790000000 }
  ],
  "action": { "side": "sell", "tokenIn": "0x…", "tokenOut": "0x…", "amountIn": "4850000000", "poolFee": 3000, "usd": "5.00" },
  "rationale": "…"
}
```

- `kind` is `trade`, `hold` or `rejected`. A `rejected` record carries `rejection { stage, error, detail, decisionSeq?,
  txHash?, replay? }`.
- The JSON is serialised once. Its UTF-8 bytes are what get published and hashed, and nothing re-serialises it
  afterwards.
- Records must fit one 1024-byte HCS chunk (`encodeDecisionFitting` shortens only the rationale). The vault cites one
  sequence number, and a chunked message would occupy several.

## The verifier

Under `packages/agent/src/verify`, I/O and judgement are separate:

- `fetchTradeEvidence` does all the Mirror Node I/O. It fetches the contract result and logs, the topic message (as the
  exact base64 bytes), the topic's submit key, the agent's account, state at the trade's block through
  `POST /api/v1/contracts/call` with `block` (the vault's topic, agent, token config and policy; Chainlink and Supra
  re-read), and the call trace from `/contracts/results/{tx}/actions`.
- `evaluateTradeEvidence` is pure. It imports only viem, zod and the decision, Hedera and network modules, so the
  browser's Tamper lab runs the exact code the CLI runs.
- `replayRejection` rebuilds `executeSwap` calldata from a `rejected` record and re-executes it through the Mirror
  Node at the recorded block and sender.
- `auditDecisionLog` pages the vault's logs (unfiltered: see the 7-day topic filter in the gotchas) and maps every
  `TradeExecuted` to its record.

The Mirror Node client (`src/mirror`) validates every response with zod, retries 429 and 5xx with backoff, and turns
404 into a typed error. Missing data gives `skip` and an `incomplete` verdict, never a false `fail`.

## The dashboard

- Server code lives in `packages/nextjs/lib/server` behind `import "server-only"`. It calls `@sh/agent` and
  `@sh/agent/verify`. Client components only call the `/api` routes (react-query, 10 s polling). The exception is the
  Tamper lab, which imports `@sh/agent/evaluate`.
- `next.config.ts` loads `packages/agent/.env` server-side. Next.js only inlines `NEXT_PUBLIC_*` variables into client
  bundles, so keys never reach the browser. Error responses redact the values of the key, secret and URL variables.
- Every page renders with no env, no deployment and no network. Unconfigured routes answer 200 with
  `{ configured: false, reason, commands }`. `next build` makes no network calls.
- History (trades, decisions) comes from the Mirror Node, never `eth_getLogs`: the relay rejects log queries over long
  block ranges.

## Trust boundaries

| Component      | Trusted for                                         | Not trusted for                                         |
| -------------- | --------------------------------------------------- | ------------------------------------------------------- |
| Agent / LLM    | Choosing whether to trade, and the size within caps | Prices, minimum output, recipients, withdrawals, honesty of its log |
| Owner          | Policy, token list, agent, topic, withdrawals       | (fully trusted; protect the key)                         |
| Chainlink      | HBAR/USD, only while Supra agrees and the price is fresh | Being the only source                                |
| Supra          | Cross-check, and the stablecoin price               | Being fresh (staleness is enforced)                      |
| SaucerSwap     | Executing the swap                                  | Paying fairly (the vault measures the balance delta against its own minimum) |
| Mirror Node    | Serving public data for verification                | Anyone can run their own and get the same verdict        |

[threat-model.md](threat-model.md) maps each threat to its mitigation and test.
