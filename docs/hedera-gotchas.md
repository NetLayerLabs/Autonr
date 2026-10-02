# Hedera gotchas

Hedera behaviour that shaped this template, and where the code handles each one. Facts marked with a date were
observed on Hedera testnet or mainnet on that date.

## Accounts and keys

**ECDSA, not ED25519, for anything that signs EVM transactions.** A Hedera account can have an ED25519 or an ECDSA
(secp256k1) key. Only ECDSA accounts have an EVM address derived from the key and can sign JSON-RPC transactions.
Create the operator account as ECDSA on the Portal. `agent:setup` creates the agent with
`setECDSAKeyWithAlias`, so one key signs its HCS messages (SDK) and its vault calls (JSON-RPC).
`packages/agent/src/config.ts` rejects ED25519 keys with an explanation.

**Two key encodings.** The Hedera Portal shows a DER-encoded hex string and a raw HEX key. EVM tools expect the raw 32
bytes. The agent accepts raw hex (with or without `0x`) and DER hex, and normalises once in `normalizeEcdsaPrivateKey`.
Foundry's `cast wallet import` (used by `yarn account:import`) takes the raw hex.

**Long-zero addresses.** Every Hedera entity has an EVM address of the form `0x000…<entity number in hex>`.
SaucerSwap's contracts and HTS tokens are reached at these addresses. Contracts deployed through the EVM (the vault,
the oracle feeds) have a CREATE address instead. ECDSA accounts are known by their alias (key-derived) address.

## HBAR units

**Tinybars inside, weibars outside.** Inside the EVM, `msg.value` and balances are in tinybars (8 decimals). Over
JSON-RPC, a transaction's `value` and `eth_getBalance` are in weibars (18 decimals); the relay converts. Sending
tinybars as `value` sends 10^10 times too little. `vault:fund` multiplies by `10^10` when it wraps HBAR
(`packages/agent/src/ops/market/fund-vault.ts`). The vault itself is not payable.

## Hedera Token Service (HTS)

**Association before receipt.** An account, contracts included, must be associated with an HTS token before it can
receive it. Otherwise transfers fail with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`. `AgentVault.associateToken` calls the HTS
system contract at `0x167` for the vault itself and treats `SUCCESS` (22) and `TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT`
(194) as success. The deploy script associates WHBAR and USDC. `agent:setup` creates the agent with unlimited automatic
associations. `vault:fund` associates the operator with WHBAR through the SDK first.

**Response codes, not reverts.** HTS precompile calls return an `int64` response code. Check it, or a failed
association looks like success. When `0x167` answers nothing or reverts, the vault reports `21` (`UNKNOWN`).

**Association is paid in gas** (about 0.7M gas per token), and `eth_estimateGas` undercounts HTS work. The deploy
script sends each association with a fixed 1,000,000 gas limit.

**HTS tokens have an ERC-20 facade.** Contracts call `approve`, `transfer`, `transferFrom`, `balanceOf` and
`decimals` at the token's address, so the vault uses plain `SafeERC20`.

**WHBAR is two entities.** The WHBAR *contract* (testnet `0.0.15057`) mints the WHBAR *token* (testnet `0.0.15058`, 8
decimals) on a payable `deposit()`. The caller must be associated with the token first.

## JSON-RPC relay and Foundry

**Forge must stay below 1.8.** Newer forge sends block parameters the Hedera JSON-RPC relay rejects
(hiero-json-rpc-relay#5826), so `forge script` and fork tests fail. Install `foundryup -i v1.7.1`. CI pins the same
version, and `template.json` declares `forge >=1.4.0 <1.8.0`.

**The relay reports HTS tokens as EIP-7702 delegations.** `eth_getCode` on any HTS token returns the delegation
designator `0xef0100 ‖ 0x167`, and `0x167` itself is a single `INVALID` opcode. A forked or simulated EVM cannot run
either, so even `decimals()` fails locally. Consequences in this repo:

- The deploy script answers its two HTS calls (`decimals()` and `associateToken`) with `vm.mockCall` during forge's
  local run.
- The Makefile deploys to Hedera with `--skip-simulation`, so forge does not replay the transactions on a fork without
  those answers. The broadcast transactions run against the real HTS.
- Fork tests use [hedera-forking](https://github.com/hashgraph/hedera-forking) (`htsSetup()`), and re-etch the HIP-719
  token proxy onto each token they touch (`packages/foundry/test/fork/HederaForkTest.sol`).

**One transaction in flight, legacy type.** Two transactions sent back to back from one key can fail with
`WRONG_NONCE`, so deploys run with `--slow --legacy`. The agent sends legacy transactions at `eth_gasPrice`.

**Gas estimates run on the Mirror Node.** The relay simulates `eth_estimateGas` against Mirror Node state. That state
trails consensus by a few seconds and can undercount HTS work. The agent adds 30% headroom, capped at 3,000,000. The
payer must hold gas limit times gas price before the relay accepts a transaction. After an SDK association,
`vault:fund` waits until the Mirror Node shows it before sending the next JSON-RPC transaction.

**`eth_call` needs a sender that exists.** The relay rejects an `eth_call` whose `from` has no Hedera account
("Sender account not found"). The red-team `not-agent` scenario calls from the vault owner (or the treasury `0.0.2`
when the owner is also the agent) instead of a random address.

**Log queries are limited.** The relay refuses `eth_getLogs` over long ranges. Read history from the Mirror Node.

**Mainnet quoter refusal and the spot fallback.** On 2026-10-01 the public mainnet Mirror Node refused every
SaucerSwap QuoterV2 simulation (HTTP 429 "Invalid request", which the relay reports as a failed simulation). The
testnet quoter worked. `quotePool` (`packages/agent/src/saucerswap/pool.ts`) tries the quoter first. If the call fails
*without* a revert, it estimates the output from the pool's spot price minus the fee and labels the result as an
estimate. A revert is SaucerSwap's real answer and is passed on.

## Hedera Consensus Service (HCS)

**1024-byte chunks.** Messages over 1024 bytes are split into chunks with separate sequence numbers. The vault cites
exactly one sequence number, so decision records are kept to one chunk (`MAX_DECISION_BYTES`, `encodeDecisionFitting`)
and published with `setMaxChunks(1)`.

**Sequence numbers are per topic.** Every topic starts at 1. With a single global "last sequence", the vault would be
stuck after `setDecisionTopic(newTopic)` until the new topic caught up. `AgentVault` keeps the last sequence per topic.
`lastReasoningSequence()` reports the current topic's, and switching back to an old topic restores its value, so old
messages still cannot be replayed.

**Submit keys gate who writes.** `agent:setup` creates the topic with the agent's ECDSA key as submit key and the
operator as admin. The Mirror Node has no history of a topic's keys, so the verifier compares the *current* submit key.
Don't rotate it after trading; create a new topic.

**Hash the bytes, not the JSON.** The Mirror Node serves messages as base64. The verifier hashes the decoded bytes
exactly as served. Re-serialising the JSON (key order, spacing, escapes) would change the hash.

**A topic that doesn't exist returns 200 with no messages**, not 404. An empty list does not prove the topic exists.
`auditDecisionLog` checks the topic itself.

## Mirror Node

**Senders are long-zero addresses.** For an `EthereumTransaction` signed by an ECDSA alias account, the contract
result's `from` is the account's long-zero address, while `vault.agent()` stores the alias. The verifier looks up the
account and accepts both forms.

**Call traces use entity IDs.** `/api/v1/contracts/results/{tx}/actions` names callers and callees by entity ID. The
verifier maps known contracts (vault, oracle feeds) back to their EVM addresses before checking the order of calls.
The Chainlink and Supra contracts are proxies, so the trace is matched on the configured proxy addresses.

**topic0 filters need a short window.** Filtering contract logs by `topic0` only works inside a timestamp range of at
most 7 days. The verifier pages the vault's logs unfiltered and decodes `TradeExecuted` locally with `agentVaultAbi`.

**`POST /api/v1/contracts/call` quirks.**

- With `block`, it re-executes against end-of-block state. An oracle updated again later in the same block reads newer
  than the receipt, so `oracle-match` reports a skip, not a fail.
- A revert is HTTP 400 `CONTRACT_REVERT_EXECUTED` with the revert data. The replay decodes it.
- Historical blocks occasionally return a transient HTTP 500 `FAIL_INVALID`. The client retries up to 4 times.
- Calling an address with no contract returns `0x`, not an error.

**Lag.** The Mirror Node trails consensus by seconds. Missing data gives an `incomplete` verdict, and execution-stage
revert reasons are read after waiting for the transaction to appear.

## Oracles on Hedera

**Supra timestamps are milliseconds.** Supra's `getSvalue(pair).time` is in milliseconds on Hedera. Both the vault and
the agent treat any value above `1e12` as milliseconds. Supra's `decimals` also differ per pair (`HBAR_USDT` 18,
`USDC_USD` 8).

**Chainlink updates on deviation or heartbeat.** A feed only updates when the price moves past its deviation threshold
or its heartbeat expires. On testnet, Chainlink HBAR/USD was observed between about 10 minutes and just over 2 hours old
(7,298 s on 2026-10-01). A 2-hour `maxPriceAge` would have refused that as stale, so the deploy uses one day on testnet
and two hours on mainnet. The agent also holds if a price is within 30 s of the limit, because a trade executes seconds
after the snapshot.

**Pyth is not usable on Hedera today.** See [Why Chainlink and Supra, not Pyth](../README.md#why-chainlink-and-supra-not-pyth).

## SaucerSwap V2

**It is a Uniswap V3 (periphery v1) fork.** The router's `exactInput` takes the struct
`(path, recipient, deadline, amountIn, amountOutMinimum)` with a deadline (selector `0xc04b8d59`). The path is
`tokenIn (20) | fee (3) | tokenOut (20)`. Fee tiers are in hundredths of a basis point (3000 = 0.30%).

**The testnet pool is mispriced.** The only liquid testnet WHBAR/USDC pool prices HBAR about 20 times above the market.
See [Testnet reality](../README.md#testnet-reality).
