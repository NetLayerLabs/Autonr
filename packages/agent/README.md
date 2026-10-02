# @sh/agent: agent runtime and verifier

The off-chain half of Autonr. It reads Chainlink and Supra, runs a strategy, checks the SaucerSwap V2 pool, simulates
the trade against `AgentVault`, publishes its reasoning to HCS and then trades through the vault. The same package
holds the Mirror Node client and the verifier that checks those trades from public data.

The package is TypeScript with no build step. The CLIs run through `tsx`, and the dashboard imports the sources
directly (`transpilePackages` in `packages/nextjs/next.config.ts`).

## Configuration

Everything reads `packages/agent/.env` (copy `.env.example`). Variables already in the environment win. The root
[README](../../README.md#environment-variables) has the full table. In short:

- **Read-only** (`loadReadOnlyConfig`, never throws): network and endpoints, plus `AUTONR_VAULT_ADDRESS` and
  `AUTONR_TOPIC_ID`. With neither set, it falls back to the reference deployment in `src/networks.ts`, if there is one.
- **Trading** (`loadAgentConfig`, throws `ConfigError` listing every missing or invalid variable): also needs
  `AGENT_ACCOUNT_ID`, `AGENT_PRIVATE_KEY`, `AUTONR_VAULT_ADDRESS` and `AUTONR_TOPIC_ID`. It never falls back to the
  reference deployment, whose vault only accepts its own agent.
- **Operator** (`loadOperatorConfig`): `OPERATOR_ACCOUNT_ID` and `OPERATOR_PRIVATE_KEY`, used by `agent:setup` and
  `vault:fund`.

Keys may be raw 32-byte hex (with or without `0x`) or the DER hex the Hedera Portal shows. ED25519 keys are refused
with an explanation.

## CLIs

Run them from the repository root. Flags go after `--`.

| Root script             | Source                    | Needs                         | Does                                                                                   |
| ----------------------- | ------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `yarn agent:setup`      | `src/cli/setup.ts`        | `OPERATOR_*`                  | Creates the agent account and decision topic if missing, then `setAgent` and `setDecisionTopic`. Writes new values to `.env`. Idempotent. |
| `yarn agent:doctor`     | `src/cli/doctor.ts`       | as much as is set             | PASS/WARN/FAIL for configuration, relay, Mirror Node, agent account, vault, topic submit key, tokens and association, oracles, pool. |
| `yarn agent:dry-run`    | `src/cli/tick.ts`         | agent + vault + topic         | A tick that publishes and sends nothing.                                                |
| `yarn agent:tick`       | `src/cli/tick.ts`         | agent + vault + topic         | One tick. `-- --buy <usd>`, `-- --sell <usd>` or `-- --dry-run`.                         |
| `yarn agent:loop`       | `src/cli/loop.ts`         | agent + vault + topic         | Ticks every `-- --interval <s>` (default 60, at least 10).                              |
| `yarn agent:hak`        | `src/cli/hak-agent.ts`    | agent + vault + topic + `ANTHROPIC_API_KEY` | A Hedera Agent Kit agent whose only tools are the Autonr plugin. `-- --dry-run`, `-- --prompt <text>`. |
| `yarn agent:red-team`   | `src/cli/red-team.ts`     | a vault                       | Six rule-breaking `eth_call`s. `-- --scenario <id>` or `all`.                            |
| `yarn vault:fund`       | `src/cli/fund-vault.ts`   | `OPERATOR_*` + vault          | `-- --hbar <n>` wraps HBAR to WHBAR for the vault; `--usdc <n>` buys USDC paid to the vault; `--dry-run` prints the plan. |
| `yarn market:inspect`   | `src/cli/inspect-market.ts` | nothing                     | Pool vs oracle, and whether a $1 buy and a $1 sell would pass. `-- --json`.              |
| `yarn verify`           | `src/cli/verify.ts`       | nothing (public data)         | `-- <tx>`, `-- --audit`, `-- --replay <seq>`. Options: `--network`, `--vault`, `--topic`, `--limit`, `--json`. |

Every CLI goes through `src/cli/_shared.ts`. It loads the env file, prints failures as one line with a fix (never a
stack trace), and exits 0 on success, 1 on failure and 2 on bad usage. A leading `--` forwarded by the package manager
is dropped.

## Source map

| Path                       | Contents                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public API for the dashboard: config, snapshot, vault state, `runTick`, red team, error decoding.               |
| `src/config.ts`            | Env parsing (zod), key normalisation, `ConfigError`, `scriptCommand`.                                           |
| `src/networks.ts`          | Per-network addresses: oracles, SaucerSwap, tokens, reference deployment. Must match `packages/foundry/script/HelperConfig.s.sol`. |
| `src/chain.ts`             | viem clients (Multicall3 batching), legacy transactions with 30% gas headroom capped at 3M.                     |
| `src/oracles/`             | Chainlink and Supra reads, the market snapshot, and the E18 math mirrored from `OracleMath.sol`.                |
| `src/strategy/`            | `rebalance` (default, pure), `llm` (Vercel AI SDK, loaded on demand), `manual`.                                 |
| `src/saucerswap/`          | Pool lookup, QuoterV2 with spot-price fallback, pool health, path encoding.                                     |
| `src/vault/`               | Vault reads, `eth_call` simulation, execution, revert decoding (`decodeVaultError`).                            |
| `src/hcs/`                 | SDK client, topic creation, `publishDecision` (single chunk, waits for the consensus record).                   |
| `src/decision/`            | The `autonr.decision/v1` schema, `encodeDecisionFitting`, `decodeDecision`.                                     |
| `src/hak/`                 | Hedera Agent Kit plugin `autonrPlugin` (market snapshot, vault state, propose trade via `runTick`, verify) and `hederaAiSdkTools`. |
| `src/agent/`               | `tick.ts` (one cycle), `red-team.ts`, `log.ts` (CLI output and `describeError`).                                |
| `src/ops/`                 | `setup.ts`, `doctor.ts`, `market/fund-vault.ts`.                                                                |
| `src/mirror/`              | Typed Mirror Node client: zod-validated, retries on 429/5xx, historical `contracts/call`.                        |
| `src/verify/`              | `fetchTradeEvidence` (I/O), `evaluateTradeEvidence` (pure, browser-safe), listings, replay, audit.              |
| `src/abi/agentVault.ts`    | Generated from `IAgentVault`. Never edit by hand; run `yarn foundry:export-abi`.                                |

## Package entry points

| Import                | For                                                                    |
| --------------------- | ---------------------------------------------------------------------- |
| `@sh/agent`           | Server code (Next.js API routes): config, `runTick`, `readVaultState`, `fetchMarketSnapshot`, `runRedTeam`, `decodeVaultError`. |
| `@sh/agent/verify`    | Server code: `verifyTrade`, `fetchTradeEvidence`, `buildTradeProof`, `listTrades`, `listDecisions`, `replayRejection`, `auditDecisionLog`. |
| `@sh/agent/hak`       | Server code: `autonrPlugin`, `autonrToolNames`, `hederaAiSdkTools`. Loads HAK, so `@sh/agent` never imports it. |
| `@sh/agent/evaluate`  | Browser: `evaluateTradeEvidence`, `buildTradeProof`, `TRACE_SELECTORS`.  |
| `@sh/agent/decision`, `/networks`, `/hedera`, `/abi` | Browser-safe shared modules.                            |

Nothing under `src/verify` or `src/mirror` may import `src/index.ts`, `dotenv`, `node:*` or `@hiero-ledger/sdk`. That
keeps `@sh/agent/evaluate` runnable in the browser, where the Tamper lab uses it.

## Tests

```bash
yarn agent:test          # vitest: every suite below, no network
yarn agent:lint
yarn agent:check-types
```

Each suite injects fakes and needs no network or keys. They cover config and key formats, the env-file round trip,
oracle math parity with `packages/foundry/test/vectors/oracle-math.json`, error decoding, the strategies (rebalance
table, LLM with a mock model), gas headroom, execution and revert decoding, every tick path, red-team calls, the
SaucerSwap math against live pool numbers, and the verifier against Mirror Node JSON fixtures, including each
tampering it must catch.
