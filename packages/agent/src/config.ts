import { PrivateKey } from "@hiero-ledger/sdk";
import { type Address, getAddress, type Hex, isAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { z } from "zod";
import { isEntityId, longZeroAddress } from "./hedera";
import { getNetwork, type NetworkName, type TokenRef } from "./networks";
import { type StrategyId } from "./strategy/types";

/** Everything needed to read the market, the vault and the decision log. Contains no secrets. */
export type ReadOnlyConfig = {
  network: NetworkName;
  rpcUrl: string;
  mirrorUrl: string;
  vaultAddress: Address | null;
  topicId: string | null;
  agentAccountId: string | null;
  agentAddress: Address | null;
  baseToken: TokenRef;
  quoteToken: TokenRef;
  /** SaucerSwap V2 fee tier of the base/quote pool, in hundredths of a basis point. */
  poolFee: number;
  tickApiEnabled: boolean;
};

/** What the agent needs to trade. Server-side only: it carries the agent's private key. */
export type AgentConfig = ReadOnlyConfig & {
  vaultAddress: Address;
  topicId: string;
  agentAccountId: string;
  agentAddress: Address;
  agentPrivateKey: Hex;
  strategy: StrategyId;
  /** Largest trade the rebalance strategy proposes, in USD; the vault's own cap still applies. */
  tradeUsd: number;
  /** Share of the vault's USD value the rebalance strategy keeps in the base token. */
  targetBaseWeight: number;
  logHolds: boolean;
  llm: { apiKey: string; model: string } | null;
};

/** The vault owner and funder, used by setup and the funding script. */
export type OperatorConfig = {
  network: NetworkName;
  rpcUrl: string;
  mirrorUrl: string;
  accountId: string;
  privateKey: Hex;
  address: Address;
};

export const DEFAULT_LLM_MODEL = "claude-sonnet-5-5";
const DEFAULT_TRADE_USD = 5;
const DEFAULT_TARGET_BASE_WEIGHT = 0.5;

type Env = Record<string, string | undefined>;

type ConfigIssue = { variable: string; problem: string };

export class ConfigError extends Error {
  /** Every variable that is unset or invalid, in the order they were checked. */
  readonly missing: string[];
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    super(`configuration incomplete: ${issues.map(issue => `${issue.variable}: ${issue.problem}`).join("; ")}`);
    this.name = "ConfigError";
    this.issues = issues;
    this.missing = issues.map(issue => issue.variable);
  }
}

/**
 * The command that runs a root script with the package manager that launched this process, e.g.
 * "npm run agent:setup". The template can be scaffolded for more than one package manager, so it is detected.
 */
export function scriptCommand(script: string, args?: string, env: Env = process.env): string {
  const manager = env.npm_config_user_agent?.split("/")[0] || "npm";
  return `${manager} run ${script}${args ? ` -- ${args}` : ""}`;
}

/** A key in the wrong format. The message never contains the key. */
class KeyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyFormatError";
  }
}

/**
 * Normalises an ECDSA (secp256k1) private key to 0x-prefixed raw hex. Accepts the raw 32 bytes, with or without 0x,
 * as EVM wallets export them, and the DER hex the Hedera Portal shows. A bare 32-byte key carries no algorithm tag; on
 * the EVM side it always means secp256k1. ED25519 keys are rejected: they cannot sign EVM transactions.
 */
export function normalizeEcdsaPrivateKey(value: string): Hex {
  const hex = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new KeyFormatError("not a hex string");
  if (hex.length === 64) return `0x${hex.toLowerCase()}`;
  let key: PrivateKey;
  try {
    key = PrivateKey.fromStringDer(hex);
  } catch {
    throw new KeyFormatError("neither raw 32-byte hex nor DER-encoded hex");
  }
  if (key.type !== "secp256k1") {
    throw new KeyFormatError(
      "an ED25519 key; EVM transactions need an ECDSA (secp256k1) key, e.g. an ECDSA Hedera Portal account",
    );
  }
  return `0x${key.toStringRaw()}`;
}

const entityId = z.string().refine(isEntityId, "expected a Hedera entity id like 0.0.1234");
const evmAddress = z
  .string()
  .refine(value => isAddress(value), "expected a 0x-prefixed 20-byte address")
  .transform(value => getAddress(value));
const httpUrl = z
  .url({ protocol: /^https?$/, error: "expected an http(s) URL" })
  .transform(url => url.replace(/\/+$/, ""));

const ecdsaKey = z.string().transform((value, ctx) => {
  try {
    const privateKey = normalizeEcdsaPrivateKey(value);
    return { privateKey, address: privateKeyToAddress(privateKey) };
  } catch (error) {
    // Our own messages describe the format; the curve library's would quote the key itself.
    const message = error instanceof KeyFormatError ? error.message : "not a valid secp256k1 private key";
    ctx.addIssue({ code: "custom", message });
    return z.NEVER;
  }
});

/**
 * Replaces the network's default base or quote token. The token's identity is required; its pricing defaults to the
 * role's (Chainlink HBAR / USD with a Supra cross-check for the base, Supra USDC_USD for the quote).
 */
const tokenOverride = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({
        code: "custom",
        message: 'expected JSON such as {"symbol":"USDT","id":"0.0.1234","decimals":6}',
      });
      return z.NEVER;
    }
  })
  .pipe(
    z.strictObject({
      symbol: z.string().min(1).max(16),
      id: entityId,
      decimals: z.number().int().min(0).max(18),
      address: evmAddress.optional(),
      chainlinkFeed: evmAddress.nullable().optional(),
      chainlinkLabel: z.string().min(1).max(16).nullable().optional(),
      supraPairId: z.number().int().nonnegative().optional(),
      supraLabel: z.string().min(1).max(16).optional(),
    }),
  );

const variables = {
  HEDERA_NETWORK: z.enum(["testnet", "mainnet"], { error: 'expected "testnet" or "mainnet"' }),
  HEDERA_RPC_URL: httpUrl,
  HEDERA_MIRROR_URL: httpUrl,
  AUTONR_VAULT_ADDRESS: evmAddress,
  AUTONR_TOPIC_ID: entityId,
  AGENT_ACCOUNT_ID: entityId,
  AGENT_PRIVATE_KEY: ecdsaKey,
  OPERATOR_ACCOUNT_ID: entityId,
  OPERATOR_PRIVATE_KEY: ecdsaKey,
  AUTONR_BASE_TOKEN: tokenOverride,
  AUTONR_QUOTE_TOKEN: tokenOverride,
  AUTONR_POOL_FEE: z.coerce.number().int().min(1).max(999_999),
  AUTONR_STRATEGY: z.enum(["rebalance", "llm"], { error: 'expected "rebalance" or "llm"' }),
  AUTONR_TRADE_USD: z.coerce.number().positive(),
  AUTONR_TARGET_BASE_WEIGHT: z.coerce.number().min(0).max(1),
  AUTONR_LOG_HOLDS: z.stringbool(),
  AUTONR_ENABLE_TICK_API: z.stringbool(),
  ANTHROPIC_API_KEY: z.string(),
  AUTONR_LLM_MODEL: z.string(),
} as const;

type Variable = keyof typeof variables;
type Parsed<V extends Variable> = z.output<(typeof variables)[V]>;

/** Parses variables one at a time and collects every problem, so a ConfigError lists them all at once. */
class EnvReader {
  readonly issues: ConfigIssue[] = [];

  constructor(private readonly env: Env) {}

  isSet(name: Variable): boolean {
    return Boolean(this.env[name]?.trim());
  }

  optional<V extends Variable>(name: V): Parsed<V> | undefined {
    const raw = this.env[name]?.trim();
    if (!raw) return undefined;
    const result = variables[name].safeParse(raw);
    if (result.success) return result.data as Parsed<V>;
    // Report the rule, never the value: several of these variables are secrets.
    this.issues.push({ variable: name, problem: result.error.issues[0]?.message ?? "invalid" });
    return undefined;
  }

  required<V extends Variable>(name: V, hint: string): Parsed<V> | undefined {
    if (!this.isSet(name)) this.issues.push({ variable: name, problem: `not set (${hint})` });
    return this.optional(name);
  }
}

type Endpoints = Pick<ReadOnlyConfig, "network" | "rpcUrl" | "mirrorUrl">;

function readEndpoints(reader: EnvReader): Endpoints {
  const network = reader.optional("HEDERA_NETWORK") ?? "testnet";
  const info = getNetwork(network);
  return {
    network,
    rpcUrl: reader.optional("HEDERA_RPC_URL") ?? info.rpcUrl,
    mirrorUrl: reader.optional("HEDERA_MIRROR_URL") ?? info.mirrorUrl,
  };
}

type Market = Pick<ReadOnlyConfig, "baseToken" | "quoteToken" | "poolFee" | "tickApiEnabled">;

function readMarket(reader: EnvReader, network: NetworkName): Market {
  const info = getNetwork(network);
  return {
    baseToken: withOverride(info.baseToken, reader.optional("AUTONR_BASE_TOKEN")),
    quoteToken: withOverride(info.quoteToken, reader.optional("AUTONR_QUOTE_TOKEN")),
    poolFee: reader.optional("AUTONR_POOL_FEE") ?? info.defaultPoolFee,
    tickApiEnabled: reader.optional("AUTONR_ENABLE_TICK_API") ?? false,
  };
}

function withOverride(token: TokenRef, override: Parsed<"AUTONR_BASE_TOKEN"> | undefined): TokenRef {
  if (!override) return token;
  return { ...token, ...override, address: override.address ?? longZeroAddress(override.id) };
}

/**
 * Configuration for reading. Never throws: unset or invalid values fall back to the network defaults, and with no
 * deployment of your own it points at the reference deployment in networks.ts, so a fresh scaffold has data to show.
 * The doctor script reports any value that was ignored.
 */
export function loadReadOnlyConfig(env: Env = process.env): ReadOnlyConfig {
  const reader = new EnvReader(env);
  const endpoints = readEndpoints(reader);
  const common = { ...endpoints, ...readMarket(reader, endpoints.network) };
  // The reference deployment is used whole or not at all: your topic next to someone else's vault would show a
  // decision log that vault never reads. A value that is set but invalid still counts as yours.
  const ownDeployment = reader.isSet("AUTONR_VAULT_ADDRESS") || reader.isSet("AUTONR_TOPIC_ID");
  const reference = ownDeployment ? null : getNetwork(endpoints.network).reference;
  if (reference) {
    return {
      ...common,
      vaultAddress: reference.vault,
      topicId: reference.topicId,
      agentAccountId: reference.agentAccountId,
      agentAddress: null,
    };
  }
  return {
    ...common,
    vaultAddress: reader.optional("AUTONR_VAULT_ADDRESS") ?? null,
    topicId: reader.optional("AUTONR_TOPIC_ID") ?? null,
    agentAccountId: reader.optional("AGENT_ACCOUNT_ID") ?? null,
    agentAddress: reader.optional("AGENT_PRIVATE_KEY")?.address ?? null,
  };
}

/**
 * Configuration for trading. Throws a ConfigError naming every unset or invalid variable. Unlike the read-only
 * config it never falls back to the reference deployment: that vault only accepts trades from its own agent.
 */
export function loadAgentConfig(env: Env = process.env): AgentConfig {
  const reader = new EnvReader(env);
  const endpoints = readEndpoints(reader);
  const market = readMarket(reader, endpoints.network);
  const createdBySetup = `${scriptCommand("agent:setup", undefined, env)} creates it`;
  const vaultAddress = reader.required(
    "AUTONR_VAULT_ADDRESS",
    `deploy one with ${scriptCommand("deploy:testnet", undefined, env)}`,
  );
  const topicId = reader.required("AUTONR_TOPIC_ID", createdBySetup);
  const agentAccountId = reader.required("AGENT_ACCOUNT_ID", createdBySetup);
  const agentKey = reader.required("AGENT_PRIVATE_KEY", createdBySetup);
  const strategy = reader.optional("AUTONR_STRATEGY") ?? "rebalance";
  const apiKey = reader.optional("ANTHROPIC_API_KEY");
  if (strategy === "llm" && !apiKey) {
    reader.issues.push({ variable: "ANTHROPIC_API_KEY", problem: "required when AUTONR_STRATEGY=llm" });
  }
  const llm = apiKey ? { apiKey, model: reader.optional("AUTONR_LLM_MODEL") ?? DEFAULT_LLM_MODEL } : null;
  const tuning = {
    tradeUsd: reader.optional("AUTONR_TRADE_USD") ?? DEFAULT_TRADE_USD,
    targetBaseWeight: reader.optional("AUTONR_TARGET_BASE_WEIGHT") ?? DEFAULT_TARGET_BASE_WEIGHT,
    logHolds: reader.optional("AUTONR_LOG_HOLDS") ?? true,
  };

  if (!vaultAddress || !topicId || !agentAccountId || !agentKey || reader.issues.length > 0) {
    throw new ConfigError(reader.issues);
  }
  return {
    ...endpoints,
    ...market,
    ...tuning,
    vaultAddress,
    topicId,
    agentAccountId,
    agentAddress: agentKey.address,
    agentPrivateKey: agentKey.privateKey,
    strategy,
    llm,
  };
}

/** The operator (vault owner) credentials. Throws a ConfigError when they are unset or invalid. */
export function loadOperatorConfig(env: Env = process.env): OperatorConfig {
  const reader = new EnvReader(env);
  const endpoints = readEndpoints(reader);
  const hint = "the ECDSA account that deployed the vault";
  const accountId = reader.required("OPERATOR_ACCOUNT_ID", hint);
  const key = reader.required("OPERATOR_PRIVATE_KEY", hint);
  if (!accountId || !key || reader.issues.length > 0) throw new ConfigError(reader.issues);
  return { ...endpoints, accountId, privateKey: key.privateKey, address: key.address };
}

export type AgentCredentials = { accountId: string; privateKey: Hex; address: Address };

/**
 * The agent's account and key when both are set, null when neither is (setup then creates the agent). Throws a
 * ConfigError when only one is set or a value is invalid.
 */
export function loadAgentCredentials(env: Env = process.env): AgentCredentials | null {
  const reader = new EnvReader(env);
  if (!reader.isSet("AGENT_ACCOUNT_ID") && !reader.isSet("AGENT_PRIVATE_KEY")) return null;
  const hint = "set both agent variables, or neither to let setup create the agent";
  const accountId = reader.required("AGENT_ACCOUNT_ID", hint);
  const key = reader.required("AGENT_PRIVATE_KEY", hint);
  if (!accountId || !key || reader.issues.length > 0) throw new ConfigError(reader.issues);
  return { accountId, privateKey: key.privateKey, address: key.address };
}

/** Your own vault and topic as configured, never the reference deployment. Throws a ConfigError for invalid values. */
export function loadOwnDeployment(env: Env = process.env): { vaultAddress: Address | null; topicId: string | null } {
  const reader = new EnvReader(env);
  const vaultAddress = reader.optional("AUTONR_VAULT_ADDRESS") ?? null;
  const topicId = reader.optional("AUTONR_TOPIC_ID") ?? null;
  if (reader.issues.length > 0) throw new ConfigError(reader.issues);
  return { vaultAddress, topicId };
}
