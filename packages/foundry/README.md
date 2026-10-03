# @sh/foundry: AgentVault

The on-chain half of Autonr. `AgentVault` holds tokens for an off-chain agent and lets it trade on SaucerSwap V2 without
trusting it with prices or funds:

- The agent decides **whether** to trade and sends only `tokenIn`, `tokenOut`, `poolFee` and `amountIn`.
- The vault decides **at what price**: Chainlink prices each leg, Supra must agree within `maxOracleDivergenceBps`
  (tokens without a Chainlink feed are priced by Supra alone), and the vault derives `amountOutMinimum` itself.
- The owner's policy caps every trade and every UTC day, enforces a cooldown and bounds price age and slippage.
- Every trade names the HCS message (topic, sequence number, keccak256 of the exact bytes) in which the agent published
  its reasoning, and sequence numbers must strictly increase, so one message can never back two trades.
- Output always goes to the vault. Only the owner can withdraw, and withdrawals keep working while trading is paused.

## Layout

| Path                                                         | What it is                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `contracts/AgentVault.sol`                                   | The vault (OpenZeppelin `Ownable2Step`, `Pausable`, `ReentrancyGuard`).     |
| `contracts/interfaces/IAgentVault.sol`                       | Public API, events and custom errors. The agent's ABI is generated from it. |
| `contracts/libraries/OracleMath.sol`                         | E18 fixed-point price math, mirrored by the agent in TypeScript.            |
| `contracts/interfaces/I{AggregatorV3,SupraSValueFeed,...}`   | Minimal interfaces for Chainlink, Supra, SaucerSwap V2 and HTS (`0x167`).   |
| `script/DeployAgentVault.s.sol`, `script/Deploy.s.sol`       | Deployment (`Deploy.s.sol` is what `yarn deploy` runs).                    |
| `script/HelperConfig.s.sol`                                  | Per-network addresses, mirroring `packages/agent/src/networks.ts`.          |
| `test/`                                                      | Unit, fuzz and invariant tests (offline) and Hedera fork tests.             |
| `test/vectors/oracle-math.json`                              | Shared math vectors: the Solidity and TypeScript tests both check them.     |

## How a trade is checked

`executeSwap` refuses with the first rule it finds broken, always in this order, so a rejection is reproducible:

1. caller is the agent (`NotAgent`), vault is not paused (`EnforcedPause`), no reentry;
2. reasoning hash is set (`ReasoningRequired`), a decision topic is set (`DecisionTopicNotSet`), the HCS sequence is
   newer than the last trade's on that topic (`ReasoningOutOfOrder`);
3. `amountIn > 0` (`ZeroAmount`), two different tokens (`InvalidPair`), both allowed (`TokenNotAllowed`, tokenIn first),
   the owner-approved fee tier for the pair (`PoolFeeNotAllowed`);
4. cooldown has passed (`CooldownActive`);
5. oracles for tokenIn, then tokenOut: positive prices (`InvalidOraclePrice`), not older than `maxPriceAge`
   (`StalePrice`), Chainlink and Supra within `maxOracleDivergenceBps` (`OracleDivergence`);
6. the trade is big enough to price (`ZeroAmount`), within `maxTradeUsd` (`TradeTooLarge`) and today's remaining cap
   (`DailyCapExceeded`);
7. the vault approves exactly `amountIn`, calls the router with its own minimum, measures the tokens that actually
   arrived (`InsufficientOutput`) and emits `TradeExecuted` with a full receipt (both oracle readings, the USD value,
   the minimum and the HCS reference).

`quote` and `oracleReading` run the same pricing without the staleness, divergence and policy checks, so a dashboard
or the agent can see what the vault would do.

## Hedera specifics

- **Token association.** A Hedera account (contracts included) must be associated with an HTS token before it can
  receive it. `associateToken` calls the HTS system contract at `0x167` for the vault itself and treats
  `SUCCESS` (22) and `TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT` (194) as success. HTS reports errors as response codes rather
  than reverts, so any other code reverts with `HtsAssociationFailed(token, code)`.
- **Association is paid in gas** (about 0.7M per token), and `eth_estimateGas` undercounts HTS work, so the deploy
  script sends each association with a fixed 1M gas limit.
- **Supra timestamps are milliseconds** on Hedera; the vault converts any value above `1e12` to seconds.
- **Staleness never subtracts** (`updatedAt + maxAge < block.timestamp`), so an oracle clock slightly ahead of the
  block cannot underflow.
- **forge cannot execute HTS locally.** The JSON-RPC relay reports `0x167` as a single `INVALID` opcode and every HTS
  token as an EIP-7702 delegation to it. The deploy script therefore answers its two HTS calls (`decimals()` and
  `associateToken`) with `vm.mockCall` during forge's local run, and the Makefile deploys to Hedera with
  `--skip-simulation`, so forge does not replay the transactions on a fork without those answers. The broadcast
  transactions run against the real HTS.

## Commands

From the repository root:

```bash
yarn foundry:test          # unit, fuzz and invariant tests; offline and deterministic (fixed fuzz seed)
yarn foundry:test:fork     # Hedera mainnet and testnet fork tests (network and curl required, about a minute)
yarn deploy                # local chain: start one first with `yarn chain`
yarn deploy:testnet        # Hedera testnet, with a keystore imported through `yarn account:import`
yarn foundry:export-abi    # rebuild and regenerate packages/agent/src/abi/agentVault.ts from IAgentVault
yarn foundry:lint          # forge fmt --check and prettier on scripts-js
```

After any change to `IAgentVault.sol`, run `yarn foundry:export-abi` and commit the regenerated ABI. The agent, the
verifier and the dashboard all decode calls, events and errors from it. An error the vault declares outside the
interface (such as `OwnershipCannotBeRenounced`) must also be added to `vaultImplementationErrorsAbi` in
`packages/agent/src/vault/abi.ts`.

Other networks or keystores: `yarn deploy -- --network hedera_mainnet --keystore my-account`. Deploys and fork tests
need Foundry below 1.8 (`foundryup -i v1.7.1`): newer forge sends block parameters the Hedera relay rejects.

### What the deploy does

`script/DeployAgentVault.s.sol` deploys the vault owned by the deployer with the default policy ($25 per trade, $100 per
UTC day, one trade a minute, prices at most two hours old (one day on testnet, whose feeds update rarely), 3% slippage,
1.5% oracle divergence), allows the network's WHBAR (Chainlink HBAR / USD, cross-checked by Supra `HBAR_USDT`) and USDC
(Supra `USDC_USD`), and on Hedera associates the vault with both. It reads two optional variables from
`packages/agent/.env`, the single env file of the template
(variables already set in the shell win):

| Variable               | Effect                                                                        |
| ---------------------- | ----------------------------------------------------------------------------- |
| `AUTONR_AGENT_ADDRESS` | Agent of the new vault. Defaults to the deployer.                             |
| `AUTONR_TOPIC_ID`      | Decision topic (`0.0.N`). Unset keeps trading disabled until the owner sets it. |

`yarn agent:setup` creates the agent account and its topic and points an existing vault at them, so a fresh deploy
needs neither. On a local chain the script deploys mock tokens, oracles and a router instead, and funds the vault, so
the
whole flow works offline.

Each deploy records `deployments/<chainId>.json`; `scripts-js/generateTsAbis.js` merges every file in `deployments/`
into `packages/nextjs/contracts/deployedContracts.ts`. Only `deployments/296.json` is committed; it holds the reference
testnet deployment until your own `deploy:testnet` replaces it (a local deploy writes `31337.json` and leaves it alone).
`git checkout packages/foundry/deployments/296.json && yarn foundry:export-abi` restores the reference entry.

## Tests

- `test/AgentVault.t.sol`: every owner function and its access control, policy validation at each boundary, token
  configuration and removal, HTS association against a stand-in for `0x167`, and one test per refusal of
  `executeSwap`, including tests that break two rules at once to pin the check order. The happy paths assert the exact
  vector amounts and the complete `TradeExecuted` receipt; hostile routers cover underpayment, partial fills and
  reentry.
- `test/OracleMath.t.sol`: every vector in `test/vectors/oracle-math.json`, plus fuzzed properties (the minimum never
  exceeds the fair output, the fair output never overpays, normalization is monotonic and lossless up to 18 decimals).
- `test/AgentVault.invariant.t.sol`: across random sequences of trades, pauses and withdrawals by every role, daily
  spending never exceeds the cap, HCS sequence numbers strictly increase with each trade, tokens only ever sit in the
  vault, the router or an address the owner withdrew to, and the agent never withdraws.
- `test/fork/`: on a mainnet fork the vault sells WHBAR for USDC through the real SaucerSwap V2 router, priced by the
  real Chainlink and Supra contracts. On a testnet fork it trades against the only liquid WHBAR/USDC pool, which prices
  HBAR about 20 times above the oracles: the sell goes through, and the buy is refused because the minimum the vault
  passes to SaucerSwap comes from the oracles. The fork tests use [hedera-forking](https://github.com/hashgraph/hedera-forking)
  to emulate HTS; `test/fork/HederaForkTest.sol` documents the two adjustments it needs.

## Verifying a deployment

HashScan reads verified sources from Sourcify:

```bash
yarn foundry:verify:testnet -- <ADDRESS> contracts/AgentVault.sol:AgentVault
```

(`foundry:verify:mainnet` for chain 295.) This runs `forge verify-contract ... --verifier sourcify`.
