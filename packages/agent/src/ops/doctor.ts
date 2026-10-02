import { PublicKey } from "@hiero-ledger/sdk";
import { formatEther, formatUnits, getAddress, isAddressEqual } from "viem";
import { describeError } from "../agent/log";
import { readClient } from "../chain";
import {
  type AgentConfig,
  ConfigError,
  loadAgentConfig,
  loadReadOnlyConfig,
  type ReadOnlyConfig,
  scriptCommand,
} from "../config";
import { getNetwork, type TokenRef } from "../networks";
import { MirrorClient } from "../mirror";
import { formatUsdPrice } from "../oracles/math";
import { fetchMarketSnapshot, type MarketSnapshot } from "../oracles/snapshot";
import { poolHealth } from "../saucerswap";
import { readVaultState, type VaultState } from "../vault/read";

type DoctorStatus = "pass" | "warn" | "fail";
type DoctorCheck = { status: DoctorStatus; title: string; detail: string; fix?: string };

type Env = Record<string, string | undefined>;

/** A check's verdict, plus what later checks need from it. */
type Outcome<T = undefined> = { check: Omit<DoctorCheck, "title">; value?: T };

/** The agent pays gas for every swap and a fee for every decision; below this it can run dry mid-session. */
const LOW_AGENT_HBAR = 5;
const ECDSA_KEY_TYPE = "ECDSA_SECP256K1";

/**
 * Checks everything a trade depends on, in the order it depends on it, and says how to fix each problem. Works with no
 * configuration at all (it then inspects the network and the reference deployment, if any); never throws.
 */
export async function runDoctor(options: { env: Env; onCheck?: (check: DoctorCheck) => void }): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const record = (check: DoctorCheck) => {
    checks.push(check);
    options.onCheck?.(check);
  };
  const run = async <T>(title: string, body: () => Promise<Outcome<T>>): Promise<T | undefined> => {
    try {
      const { check, value } = await body();
      record({ title, ...check });
      return value;
    } catch (error) {
      record({ title, status: "fail", detail: describeError(error) });
      return undefined;
    }
  };

  const agent = await run("configuration", () => checkConfiguration(options.env));
  const cfg: ReadOnlyConfig = agent ?? loadReadOnlyConfig(options.env);
  const mirror = new MirrorClient({ baseUrl: cfg.mirrorUrl });

  const relayOk = await run("json-rpc relay", () => checkRelay(cfg));
  await run("mirror node", () => checkMirror(cfg, mirror));
  if (!relayOk) return checks;

  if (agent) await run("agent account", () => checkAgentAccount(agent, mirror));
  const state = cfg.vaultAddress ? await run("vault", () => checkVault(cfg, agent)) : undefined;
  if (state) {
    await run("decision topic", () => checkTopic(state, agent, mirror));
    for (const token of [cfg.baseToken, cfg.quoteToken]) {
      await run(`token ${token.symbol}`, () => checkToken(cfg, state, token, mirror));
    }
  }
  const snapshot = await run("oracles", () => checkOracles(cfg, state));
  if (snapshot) await run("saucerswap pool", () => checkPool(cfg, snapshot));
  return checks;
}

async function checkConfiguration(env: Env): Promise<Outcome<AgentConfig>> {
  try {
    const cfg = loadAgentConfig(env);
    const detail = `${cfg.network}, vault ${cfg.vaultAddress}, agent ${cfg.agentAccountId}, strategy ${cfg.strategy}`;
    return { check: { status: "pass", detail }, value: cfg };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    const detail = error.issues.map(issue => `${issue.variable}: ${issue.problem}`).join("; ");
    const fix = `set them in packages/agent/.env (template: .env.example); ${scriptCommand("agent:setup")} creates the agent and topic`;
    return { check: { status: "fail", detail, fix } };
  }
}

async function checkRelay(cfg: ReadOnlyConfig): Promise<Outcome<true>> {
  const client = readClient(cfg);
  const [chainId, block] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  const expected = getNetwork(cfg.network).chainId;
  if (chainId !== expected) {
    const detail = `${cfg.rpcUrl} is chain ${chainId}, expected ${expected} (${cfg.network})`;
    return { check: { status: "fail", detail, fix: "point HEDERA_RPC_URL at a relay for HEDERA_NETWORK" } };
  }
  return {
    check: { status: "pass", detail: `${cfg.rpcUrl} answers as chain ${chainId} at block ${block}` },
    value: true,
  };
}

async function checkMirror(cfg: ReadOnlyConfig, mirror: MirrorClient): Promise<Outcome> {
  const latest = await mirror.latestBlock();
  if (!latest) {
    return { check: { status: "fail", detail: `${cfg.mirrorUrl} returned no blocks`, fix: "check HEDERA_MIRROR_URL" } };
  }
  const lagSeconds = Math.max(0, Math.round(Date.now() / 1000 - Number(latest.closedAt)));
  const detail = `${cfg.mirrorUrl} at block ${latest.number}, ${lagSeconds} s behind`;
  return { check: { status: lagSeconds > 60 ? "warn" : "pass", detail } };
}

async function checkAgentAccount(cfg: AgentConfig, mirror: MirrorClient): Promise<Outcome> {
  const [account, weibars] = await Promise.all([
    mirror.account(cfg.agentAccountId),
    readClient(cfg).getBalance({ address: cfg.agentAddress }),
  ]);
  const recreate = `clear AGENT_ACCOUNT_ID and AGENT_PRIVATE_KEY, then ${scriptCommand("agent:setup")} creates an ECDSA agent`;
  if (account.key?._type !== ECDSA_KEY_TYPE) {
    const detail = `${cfg.agentAccountId} has a ${account.key?._type ?? "missing"} key; EVM transactions need ${ECDSA_KEY_TYPE}`;
    return { check: { status: "fail", detail, fix: recreate } };
  }
  if (!account.evm_address || !isAddressEqual(account.evm_address, cfg.agentAddress)) {
    const detail = `AGENT_PRIVATE_KEY controls ${cfg.agentAddress}, but ${cfg.agentAccountId} is ${account.evm_address ?? "an account without EVM address"}`;
    return { check: { status: "fail", detail, fix: recreate } };
  }
  // JSON-RPC reports balances in weibars (18 decimals), so formatEther yields HBAR.
  const hbar = Number(formatEther(weibars));
  const detail = `${cfg.agentAccountId} is an ECDSA account at ${cfg.agentAddress} holding ${hbar.toFixed(2)} HBAR`;
  if (hbar < LOW_AGENT_HBAR) {
    return {
      check: { status: "warn", detail, fix: `send HBAR to ${cfg.agentAccountId}: it pays every HCS message and swap` },
    };
  }
  return { check: { status: "pass", detail } };
}

async function checkVault(cfg: ReadOnlyConfig, agent: AgentConfig | undefined): Promise<Outcome<VaultState>> {
  const state = await readVaultState(cfg);
  if (!state) throw new Error("no vault configured");
  const setup = `the vault owner runs ${scriptCommand("agent:setup")}`;
  const summary = `${state.address}, owner ${state.owner}, agent ${state.agent}, ${state.tradeCount} trades`;
  if (agent && !isAddressEqual(state.agent, agent.agentAddress)) {
    const detail = `${summary}; the vault's agent is not AGENT_PRIVATE_KEY's address ${agent.agentAddress}`;
    return { check: { status: "fail", detail, fix: setup }, value: state };
  }
  if (!state.topicId) {
    const detail = `${summary}; no decision topic is set, so the vault refuses every trade`;
    return { check: { status: "fail", detail, fix: setup }, value: state };
  }
  if (agent && state.topicId !== agent.topicId) {
    const detail = `${summary}; the vault cites topic ${state.topicId}, AUTONR_TOPIC_ID is ${agent.topicId}`;
    return { check: { status: "fail", detail, fix: setup }, value: state };
  }
  if (state.poolFee === 0) {
    const detail = `${summary}; no SaucerSwap fee tier is approved for ${cfg.baseToken.symbol}/${cfg.quoteToken.symbol}, so the vault refuses every trade`;
    return {
      check: { status: "fail", detail, fix: "the owner sets the pair's fee tier from the Owner page" },
      value: state,
    };
  }
  if (state.paused) {
    return {
      check: { status: "warn", detail: `${summary}; paused`, fix: "the owner unpauses it from the Owner page" },
      value: state,
    };
  }
  const detail = `${summary}; decisions on ${state.topicId}; fee tier ${state.poolFee}`;
  return { check: { status: "pass", detail }, value: state };
}

/** The same check a verifier runs: one key must both write the decision log and sign the vault's trades. */
async function checkTopic(state: VaultState, agent: AgentConfig | undefined, mirror: MirrorClient): Promise<Outcome> {
  const topicId = state.topicId;
  if (!topicId) return { check: { status: "fail", detail: "the vault has no decision topic" } };
  const topic = await mirror.topic(topicId);
  const fix = `create a topic whose submit key is the agent's: clear AUTONR_TOPIC_ID and run ${scriptCommand("agent:setup")}`;
  if (topic.deleted) return { check: { status: "fail", detail: `${topicId} is deleted`, fix } };
  if (!topic.submit_key) {
    return { check: { status: "fail", detail: `${topicId} has no submit key, so anyone can write to it`, fix } };
  }
  if (topic.submit_key._type !== ECDSA_KEY_TYPE) {
    const detail = `${topicId} has a ${topic.submit_key._type} submit key; it must be the agent's single ECDSA key`;
    return { check: { status: "fail", detail, fix } };
  }
  const submitter = getAddress(`0x${PublicKey.fromStringECDSA(topic.submit_key.key).toEvmAddress()}`);
  if (!isAddressEqual(submitter, state.agent) || (agent && !isAddressEqual(submitter, agent.agentAddress))) {
    const detail = `${topicId} accepts messages signed for ${submitter}, but the vault's agent is ${state.agent}`;
    return { check: { status: "fail", detail, fix } };
  }
  return { check: { status: "pass", detail: `only ${submitter}, the vault's agent, can write to ${topicId}` } };
}

async function checkToken(
  cfg: ReadOnlyConfig,
  state: VaultState,
  token: TokenRef,
  mirror: MirrorClient,
): Promise<Outcome> {
  const configured = state.tokens.find(candidate => isAddressEqual(candidate.address, token.address));
  if (!configured) {
    const detail = `${token.symbol} (${token.id}) is not allowed by the vault`;
    return { check: { status: "fail", detail, fix: `the owner calls configureToken for ${token.address}` } };
  }
  // A token the vault is not associated with can never arrive: the swap's transfer to the vault would fail.
  if ((await mirror.tokenBalance(state.address, token.id)) === null) {
    const detail = `the vault is not associated with ${token.symbol} (${token.id})`;
    return { check: { status: "fail", detail, fix: `the owner calls associateToken(${token.address})` } };
  }
  const sameOracles =
    (configured.chainlinkFeed ?? null) === (token.chainlinkFeed ? getAddress(token.chainlinkFeed) : null) &&
    configured.supraPairId === token.supraPairId;
  const pricing = `Chainlink ${configured.chainlinkFeed ?? "none"}, Supra pair ${configured.supraPairId ?? "none"}`;
  if (!sameOracles) {
    const detail = `the vault prices ${token.symbol} with ${pricing}, unlike the agent's networks.ts entry`;
    return { check: { status: "warn", detail, fix: "align AUTONR_BASE_TOKEN / AUTONR_QUOTE_TOKEN with the vault" } };
  }
  const balance = `${formatUnits(BigInt(configured.balance), configured.decimals)} ${token.symbol}`;
  const detail = `${token.symbol} allowed and associated (${pricing}); the vault holds ${balance}`;
  if (configured.balance === "0") {
    const amount = token === cfg.baseToken ? "--hbar 50" : "--usdc 5";
    return { check: { status: "warn", detail, fix: `fund the vault: ${scriptCommand("vault:fund", amount)}` } };
  }
  return { check: { status: "pass", detail } };
}

async function checkOracles(cfg: ReadOnlyConfig, state: VaultState | undefined): Promise<Outcome<MarketSnapshot>> {
  const snapshot = await fetchMarketSnapshot(cfg);
  const readings = [snapshot.base, snapshot.quote].flatMap(oracle => [
    { label: `${oracle.symbol} ${oracle.source}`, priceUsd: oracle.priceUsd, age: oracle.ageSeconds },
    ...(oracle.crossCheck
      ? [{ label: `${oracle.symbol} supra`, priceUsd: oracle.crossCheck.priceUsd, age: oracle.crossCheck.ageSeconds }]
      : []),
  ]);
  const detail = readings.map(r => `${r.label} ${formatUsdPrice(r.priceUsd)} (${r.age} s old)`).join(", ");
  if (!state) return { check: { status: "pass", detail }, value: snapshot };

  const { maxPriceAge, maxOracleDivergenceBps } = state.policy;
  const stale = readings.filter(reading => reading.age > maxPriceAge).map(reading => reading.label);
  const diverging = [snapshot.base, snapshot.quote].filter(
    oracle => oracle.crossCheck && oracle.crossCheck.divergenceBps > maxOracleDivergenceBps,
  );
  if (stale.length > 0 || diverging.length > 0) {
    const problems = [
      ...stale.map(label => `${label} is older than ${maxPriceAge} s`),
      ...diverging.map(oracle => `${oracle.symbol} sources differ by ${oracle.crossCheck?.divergenceBps} bps`),
    ];
    const fix = "the vault refuses trades until the feeds update; the owner can widen the policy if this persists";
    return { check: { status: "fail", detail: `${detail}; ${problems.join("; ")}`, fix }, value: snapshot };
  }
  return { check: { status: "pass", detail: `${detail}; within the vault's limits` }, value: snapshot };
}

async function checkPool(cfg: ReadOnlyConfig, snapshot: MarketSnapshot): Promise<Outcome> {
  const health = await poolHealth(cfg, snapshot);
  if (!health.pool) {
    return { check: { status: "fail", detail: health.detail, fix: "set AUTONR_POOL_FEE to a fee tier with a pool" } };
  }
  if (health.buyAccepted && health.sellAccepted) return { check: { status: "pass", detail: health.detail } };
  // One-sided refusal is expected when the pool trades away from the oracles (the testnet WHBAR/USDC pool does).
  const status = health.buyAccepted || health.sellAccepted ? "warn" : "fail";
  return {
    check: {
      status,
      detail: health.detail,
      fix: `${scriptCommand("market:inspect")} shows the pool against the oracles`,
    },
  };
}
