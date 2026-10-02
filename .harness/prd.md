# Autonr: let an AI agent trade without trusting it

This PRD describes the Autonr template as it ships. Running the harness against it checks that a change kept the
template's guarantees. To build a feature on top, replace "Scope of a run" below with your brief and keep the rest:
it is the contract the validators enforce.

## Problem

An agent that holds keys and decides its own prices is a single point of failure. It can hallucinate a price, be
prompt-injected or leak its key, and afterwards there is only its own word for why it traded.

## What Autonr is

A Scaffold-HBAR monorepo (Foundry, TypeScript agent, Next.js dashboard) that splits an autonomous trader into parts
that do not trust each other:

- **The agent decides whether to trade** (`packages/agent`). A strategy (deterministic `rebalance`, an `llm` strategy
  through the Vercel AI SDK, or `manual`) returns hold, or a side and a USD size. The agent sends the vault only
  `tokenIn`, `tokenOut`, `poolFee` and `amountIn`. It never sends a price, a minimum output or a recipient, and it
  cannot withdraw.
- **Two oracle networks decide at what price** (`packages/foundry`, `AgentVault`). The vault prices each leg with
  Chainlink, refuses unless Supra agrees within the divergence tolerance and both are fresh, derives
  `amountOutMinimum` itself, enforces the owner's per-trade cap, daily cap, token allow-list, approved fee tier and
  cooldown, and only then swaps on SaucerSwap V2 with itself as the recipient.
- **The reasoning comes before the trade.** Before every trade the agent publishes a decision record
  (`autonr.decision/v1`, one HCS message of at most 1024 bytes) to a topic whose only submit key is the agent's key.
  `executeSwap` must cite the keccak256 of that message's exact bytes and a sequence number newer than the last one it
  traded on. Holds and refusals are logged too.
- **Anyone can check it.** A verifier (`yarn verify -- <tx>`) re-checks a trade from public Mirror Node data only:
  12 checks, from the hash match and HCS-before-trade ordering to the oracle readings at the trade's block and the
  call trace. `--audit` maps every trade to a record; `--replay <seq>` re-runs a refused call at its historical block.

## Users and journeys

1. **A visitor with no keys** scaffolds the template and runs `yarn start`. The dashboard (`/`) shows live Chainlink
   and Supra prices from testnet, the reference vault's policy, the decision log and the trades. Every panel that
   needs configuration shows the exact command that would fill it instead of an error.
2. **A skeptic** opens `/proof/<tx>` for a trade and sees the 12 checks pass, the HCS message published before the
   trade, and the Tamper lab: changing one byte of the message, `amountIn`, the ordering or the submit key in the
   browser turns the matching check red.
3. **An auditor** opens `/audit`: every `TradeExecuted` maps to an earlier trade record, refusals can be replayed.
4. **A red-teamer** opens `/playground` (or runs `yarn agent:red-team`) and asks the live vault, as eth_call
   simulations, to break each rule. Every call is refused with its expected custom error. Nothing is signed.
5. **An owner** uses `/owner` with a wallet to pause, set the policy, configure tokens, change the agent and withdraw.
   None of these are callable by the agent key.
6. **A builder** follows the README to deploy their own vault (`yarn deploy:testnet`), create the agent and topic
   (`yarn agent:setup`), fund it and run `yarn agent:tick`.

## Reference deployment (Hedera testnet)

| What | Id |
| ---- | -- |
| AgentVault | `0x037b24d59836e1C0cb9Fe571f004409D81eba472` |
| Agent account (only submit key on the topic) | `0.0.10821548` |
| HCS decision topic | `0.0.10821549` |
| Executed trade (`TradeExecuted`) | `0x61430295e8342246ec6e432921017c0a49fa961fc814ded1e7c2065d9d514158` |

A fresh scaffold with no `packages/agent/.env` shows this deployment.

## Non-negotiables

The invariants in `AGENTS.md` are part of this PRD. In short:

- `executeSwap` keeps its check order, and the minimum output, recipient and price never come from the caller.
- Decision records are encoded once, published as one chunk, and the published bytes are the hashed bytes.
- The agent waits for the HCS sequence number before it signs the trade; every outcome is logged.
- After any change to `AgentVault.sol` or `IAgentVault.sol`, regenerate the ABI with `yarn foundry:export-abi`.
- Solidity and TypeScript oracle math stay in parity with `packages/foundry/test/vectors/oracle-math.json`.
- A fresh scaffold installs, lints, type-checks, builds and boots with no env file; `next build` makes no network calls.
- Keys stay server-side in `packages/agent` and `packages/nextjs/lib/server`, never logged or sent to the browser.
- History comes from the Mirror Node, never `eth_getLogs`.
- There is no Pyth, ethers or LangChain in the agent; no Hardhat workspace.

## Scope of a run

Keep the template green: lint, types, forge tests, agent tests and the production build pass, and the live
reference deployment still verifies. Do not deploy contracts, create topics or send transactions during a run.

## Out of scope

Mainnet, custody beyond the vault, multi-pair routing, and any change that lets the agent choose a price, a minimum
output, a recipient or a withdrawal.
