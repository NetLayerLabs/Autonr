# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Codex, ...) and humans changing a project scaffolded from Autonr.
`CLAUDE.md` includes this file. Read [README.md](README.md) for what the template does and
[docs/architecture.md](docs/architecture.md) for how it fits together.

## What this is

A Scaffold-HBAR monorepo where an off-chain agent trades on SaucerSwap V2 through an on-chain `AgentVault`. The agent
decides whether to trade. The vault prices each leg with Chainlink, requires Supra to agree, enforces the owner's
policy and derives the minimum output itself. Every trade must cite an HCS message holding the agent's reasoning, and a
verifier checks trades from Mirror Node data only.

Stack: Foundry (Solidity 0.8.33, OpenZeppelin v5), TypeScript with viem, `@hiero-ledger/sdk` for HCS and accounts, zod,
the Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) for the optional LLM strategy, and Next.js for the dashboard.
There is no Pyth, ethers or LangChain in the agent. See the README for why Pyth is not used.

## Layout and ownership

| Path | Owns | Notes |
| ---- | ---- | ----- |
| `packages/foundry/contracts/AgentVault.sol` | The vault | Implements `interfaces/IAgentVault.sol` exactly. |
| `packages/foundry/contracts/interfaces/IAgentVault.sol` | Public API, events, custom errors | Source of the agent's ABI. |
| `packages/foundry/contracts/libraries/OracleMath.sol` | E18 price math | Mirrored by `packages/agent/src/oracles/math.ts`. |
| `packages/foundry/script/` | Deploy (`Deploy.s.sol` → `DeployAgentVault.s.sol`), `HelperConfig.s.sol` | Addresses must match `packages/agent/src/networks.ts`. |
| `packages/foundry/test/` | Unit, fuzz, invariant (offline), `fork/` (live Hedera), `vectors/oracle-math.json` | |
| `packages/agent/src/` | Agent runtime, SaucerSwap tools, Mirror Node client, verifier, CLIs | See [packages/agent/README.md](packages/agent/README.md). |
| `packages/agent/src/abi/agentVault.ts` | Generated ABI | Never edit by hand. |
| `packages/nextjs/app/` | Pages (`/`, `/proof/[tx]`, `/audit`, `/playground`, `/owner`, `/debug`) and `api/` routes | |
| `packages/nextjs/lib/server/` | Server-only glue to `@sh/agent` | `import "server-only"`. |
| `packages/nextjs/lib/commands.ts` | Commands shown in the UI | The scaffold CLI rewrites them when the project uses npm. |
| `packages/agent/.env` | The single env file for CLIs, deploy and dashboard | Never commit it. Document new variables in `.env.example`. |

## Invariants: do not break these

1. **`executeSwap` check order.** Caller and pause, then reasoning (hash, topic, sequence), then amount, pair and
   allow-list, then cooldown, then oracles (tokenIn before tokenOut; Chainlink validity and freshness, then Supra
   validity, freshness and divergence), then trade size and daily cap, then effects, then the swap. Tests named
   `test_executeSwap_checks*Before*` pin it. Replay compares error names, so reordering changes what historical
   rejections reproduce.
2. **The minimum output comes from the oracles, inside the vault.** `SwapRequest` has no minimum or price field, and
   the swap recipient is always `address(this)`. Never let the caller supply a minimum, a recipient or a price. The
   vault measures the balance delta itself and resets the router allowance.
3. **Reasoning precondition.** The vault refuses a zero hash, a missing topic, or a sequence that is not strictly above
   the last one *on the current topic* (`_lastSequenceByTopic`). The agent publishes the record, waits for its
   consensus record, then sends `executeSwap` with `{ keccak256(bytes), sequence }`. Never sign the trade before the
   message has a sequence number.
4. **One HCS chunk per record.** Records are at most `MAX_DECISION_BYTES` (1024) and published with
   `setMaxChunks(1)`. Build them with `encodeDecisionFitting`, which only shortens the rationale. Never trim the
   action, market data or rejection.
5. **Hash the exact bytes.** `encodeDecision` serialises once. The bytes published are the bytes hashed, and the
   verifier hashes the Mirror Node's base64-decoded bytes. Never re-serialise, pretty-print or reorder a record after
   encoding.
6. **Every outcome is logged.** Every published `trade` record needs a `TradeExecuted` or an execution-stage
   `rejected` record with `decisionSeq`. A simulation-stage `rejected` record needs `replay { block, from,
   reasoningHash, sequence }`. The agent pays for its own messages. The audit and replay depend on all of this.
7. **ABI and bytecode regeneration.** After any change to `AgentVault.sol` or `IAgentVault.sol` (even a comment: the verifier's `vault-code` check compares bytecode including the metadata hash), run `yarn foundry:export-abi` and commit
   `packages/agent/src/abi/agentVault.ts`. An error declared in `AgentVault` but not in the interface must also go into
   `vaultImplementationErrorsAbi` (`packages/agent/src/vault/abi.ts`), or `decodeVaultError` reports it as `Unknown`.
8. **Browser-safe evaluate module.** `packages/agent/src/verify/evaluate.ts` is pure and runs in the browser (Tamper
   lab). Nothing under `src/verify` or `src/mirror` may import `src/index.ts`, `src/config.ts`, `src/chain.ts`,
   `dotenv`, `node:*` or `@hiero-ledger/sdk`. Keep I/O in `fetch.ts` and judgement in `evaluate.ts`.
9. **Math parity.** Solidity and TypeScript use the same E18 formulas and both test against
   `packages/foundry/test/vectors/oracle-math.json`. Change both sides and the vectors together. Supra `time` above
   `1e12` is milliseconds. Staleness never subtracts (`updatedAt + maxAge < now`).
10. **Network parity.** `packages/agent/src/networks.ts` and `packages/foundry/script/HelperConfig.s.sol` carry the
    same addresses. `test_hederaConfigMatchesTheAgentNetworks` fails otherwise.
11. **The gate.** A fresh scaffold must install, lint, build and boot with no env vars. Every page returns 200, API
    routes answer `{ configured: false, ... }` instead of erroring, and `next build` makes no network calls.
12. **Secrets stay server-side.** Keys are read only in `packages/agent` and `packages/nextjs/lib/server`. They are
    never logged, and never echoed in config errors. API error responses redact them.
13. **History comes from the Mirror Node**, never `eth_getLogs` or `useScaffoldEventHistory`: the relay rejects long
    log ranges.
14. **Dependencies.** Each workspace imports only what its own `package.json` declares (hoisting is per workspace).
    Versions are pinned exactly. There is one prettier, 3.8.1, everywhere. The LLM strategy stays behind
    `await import("./llm")`, so the AI SDK is only loaded when `AUTONR_STRATEGY=llm`.
15. **Package-manager neutrality.** Workspace scripts call binaries directly, never through the package manager. Code
    strings never name a package manager (`lib/commands.ts` is the one deliberate exception). Use
    `scriptCommand()` to print commands.
16. **Don't rotate a topic's submit key after trading.** The verifier compares the current key. Create a new topic
    instead.

## Validate a change

From the repository root:

```bash
yarn foundry:test          # contracts: unit, fuzz, invariant (offline, about 1 s)
yarn foundry:lint          # forge fmt --check + prettier
yarn agent:test            # vitest, offline
yarn agent:lint
yarn agent:check-types
yarn next:lint
yarn next:check-types
yarn next:build            # must pass with no packages/agent/.env
```

`yarn test`, `yarn lint` and `yarn check-types` run the per-workspace commands together. Also run these where they
apply:

- Contract size: `forge build --sizes` in `packages/foundry`.
- Live integration (needs network and curl, about a minute): `yarn foundry:test:fork`.
- Live, read-only: `yarn market:inspect`, `yarn agent:doctor`, `yarn agent:red-team`, `yarn verify -- <tx>`.
- The gate: start `yarn start` with no env file and load every page.

Forge must be below 1.8 (`foundryup -i v1.7.1`).

## Recipes

### Add a vault rule

1. Add the custom error to `IAgentVault.sol`, and put the check in `executeSwap` at a deliberate place in the order.
2. Add a test for the refusal and one that breaks this rule together with its neighbour, to pin the order.
3. Run `yarn foundry:export-abi`.
4. If the agent can predict the refusal, make the tick hold first (`vaultWouldRefuse` in `src/agent/tick.ts`).
5. Optionally add a red-team scenario (`RED_TEAM_SCENARIOS` in `src/agent/red-team.ts`, plus its test). The playground
   picks it up.
6. Update the README troubleshooting table and `docs/threat-model.md`.

### Add a token

- **On-chain:** the owner calls `configureToken(token, chainlinkFeed, supraPairId, supraEnabled)` (`address(0)` as the
  feed means Supra alone prices it), then `associateToken(token)`. Both are on `/owner`.
- **For the agent:** one agent trades one base/quote pair. Point it at another pair with `AUTONR_BASE_TOKEN` /
  `AUTONR_QUOTE_TOKEN` (JSON: `symbol`, `id`, `decimals`, optional `address`, `chainlinkFeed`, `chainlinkLabel`,
  `supraPairId`, `supraLabel`) and `AUTONR_POOL_FEE`.
- **To change a default:** edit `NETWORKS` in `packages/agent/src/networks.ts` *and* `HelperConfig.s.sol`. Run
  `yarn foundry:test`, which checks they match. Confirm the oracle and pool addresses with an `eth_call` first.

### Add a strategy

1. Create `packages/agent/src/strategy/<name>.ts` exporting a `Strategy` (`id`, `version`, `decide`). `decide` returns
   a hold or `{ side, usd, rationale }`. It never returns prices or amounts: the tick converts USD at the oracle price,
   and the vault re-prices. Bump `version` whenever the logic changes, because records cite it.
2. Add the ID to `StrategyId` (`strategy/types.ts`), select it in `loadStrategy` (`strategy/index.ts`; use a dynamic
   import if it pulls in heavy dependencies), and allow it in the `AUTONR_STRATEGY` enum in `src/config.ts`.
3. Document any new variables in `packages/agent/.env.example` and the README table.
4. Test it like `test/rebalance.test.ts` (pure) or `test/llm.test.ts` (mock model). On any failure, hold with a reason.

### Add a verification check

1. Add the ID to `CheckId` (`src/verify/types.ts`) and a title to `TITLES` (`src/verify/evaluate.ts`).
2. Implement it in `evaluate.ts` as a pure function of `TradeEvidence`. If it needs new data, extend `TradeEvidence`
   and fetch the data in `src/verify/fetch.ts` (Mirror Node only). Missing data is a `skip`, never a `fail`.
3. In `test/verify/verify-trade.test.ts`, add a passing case on the honest fixture and a failing tampered case.
4. Optionally add a Tamper lab mutation in `packages/nextjs/app/proof/[tx]/_components/tamperings.ts`.
5. Update the check count and table in the README and the threat model.

## Hedera gotchas

[docs/hedera-gotchas.md](docs/hedera-gotchas.md) covers each of these in detail. The short list:

- HBAR is in tinybars (8 dp) inside the EVM and in weibars (18 dp) over JSON-RPC.
- An HTS token must be associated before an account or contract can receive it, and HTS returns response codes rather
  than reverting.
- The relay reports HTS tokens as EIP-7702 delegations, so forge cannot simulate HTS. Hedera deploys use
  `--skip-simulation`, and fork tests use hedera-forking.
- Forge must be below 1.8.
- Send one transaction at a time (`--slow`), legacy type. Gas estimates come from the Mirror Node, plus 30% headroom.
- On the Mirror Node, senders are long-zero addresses and call traces use entity IDs. topic0 log filters need a 7-day
  window. `contracts/call` reverts are HTTP 400 with data.
- Supra timestamps are milliseconds. Chainlink updates on deviation or heartbeat, so testnet prices can be hours old.
- HCS messages over 1024 bytes are chunked, and sequence numbers restart for each topic.
- Use ECDSA keys, not ED25519. The Portal shows both DER and raw hex encodings.

## Review aids

- `.claude/agents/grumpy-carlos-code-reviewer.md` (also under `.agents/`) is a strict reviewer for Scaffold-HBAR code.
- `.agents/skills/solidity-security/SKILL.md` holds Solidity security patterns.
- Comments explain *why* (Hedera quirks, security reasoning), never what. Match the existing style: 2-space
  TypeScript with prettier width 120, and `forge fmt` for Solidity.
