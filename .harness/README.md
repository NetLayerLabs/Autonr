# Hedera Harness recipe

[Hedera Harness](https://github.com/hedera-dev/hedera-harness) `1.2.2` (npm `latest`, recipe `schemaVersion: 2`) gives
a coding agent this repo's context and decides, with tiered validators, whether its change passed. It is pinned in
the root `devDependencies`:

```bash
yarn harness:doctor      # recipe + host preflight; no agent, no keys
yarn harness:validate    # Tier 0 + static tier + live tier, no agent
yarn harness:validate:offline   # Tier 0 + static tier only, no network
yarn harness:run         # agent run on a new harness/run-* branch (clean tree, logged-in `claude` CLI)
```

| File | Stage | What it proves |
| ---- | ----- | -------------- |
| `spec.yaml` | all | baseline, workspaces, forbidden files, secret patterns, which validators run |
| `spec.offline.yaml` | all | the same recipe with the live tier dropped |
| `prd.md` | GENERATE | what Autonr is and the invariants a change must keep |
| `validators/static.json` | ASSERT (Tier 0) | required files, harness pins, Solidity/schema/reference-id needles, no `.env`, no Hardhat, no stale `harness-spec.yaml` |
| `validators/yarn.json` | ASSERT (Tier 1) | static tier, then live tier (below) |
| `acceptance-contract.json` | EVALUATE (Tier 3) | C1-C6, graded by an adversarial agent in a browser with no keys |
| `checks/live-chain.mjs` | live tier | zero-dependency Mirror Node checks, independent of `packages/agent` |

## Tiers

**Static tier** (offline, no keys): `yarn install`, `yarn lint`, `yarn check-types`, `yarn foundry:test`,
`yarn agent:test`, `yarn build`. Needs forge below 1.8 on the host.

**Live tier** (public testnet reads only; nothing is signed, no key is read):

| Command | Passes when |
| ------- | ----------- |
| `live-hcs-decisions` | topic `0.0.10821549` has a submit key and holds at least one single-chunk, at most 1024-byte, valid `autonr.decision/v1` record that cites the vault and is paid by the agent it names |
| `live-vault-trade` | vault `0x037b24d59836e1C0cb9Fe571f004409D81eba472` has a `SUCCESS` `executeSwap` whose logs include the vault's `TradeExecuted`, citing that topic |
| `live-verify` | `yarn verify -- 0x61430295e8342246ec6e432921017c0a49fa961fc814ded1e7c2065d9d514158` exits 0 (12 checks) |
| `live-red-team` | `yarn agent:red-team` against the reference vault: all six rule-breaking eth_calls refused with their expected errors |

`node .harness/checks/live-chain.mjs hcs|trade --topic <id> --vault <0x...>` points the first two at your own
deployment.

## Keys

The recipe forbids `packages/agent/.env` (operator and agent keys): do not run a coding agent next to it. Run the
harness in a fresh scaffold or a `git worktree`. Every validator is keyless, and the live tier pins the reference
deployment. `packages/foundry/.env` is allowed: the foundry postinstall creates it and it holds no key.

## npm projects

create-scaffold-hbar copies `.harness/` without its npm rewrite, so the recipe keeps yarn commands. In a project
scaffolded with `--package-manager npm`, set `constraints.packageManager: npm`, change the baseline commands to
`npm install` / `npm run …`, and point `validators.commands` at `validators/npm.json` (or `validators/npm.offline.json`
in `spec.offline.yaml`). The `harness:*` scripts in `package.json` are rewritten by the CLI.

Runtime output (`.harness/runs/`, `runtime/`, `cache/`, `skills/`) is gitignored.
