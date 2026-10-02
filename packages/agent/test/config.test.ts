import { generateKeyPairSync } from "node:crypto";
import { PrivateKey } from "@hiero-ledger/sdk";
import { privateKeyToAddress } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_LLM_MODEL,
  loadAgentConfig,
  loadAgentCredentials,
  loadOperatorConfig,
  loadReadOnlyConfig,
  normalizeEcdsaPrivateKey,
  scriptCommand,
} from "../src/config";
import { longZeroAddress } from "../src/hedera";
import { NETWORKS } from "../src/networks";
import { AGENT_KEY, VAULT_ADDRESS } from "./fixtures";

const tradingEnv = {
  AUTONR_VAULT_ADDRESS: VAULT_ADDRESS.toLowerCase(),
  AUTONR_TOPIC_ID: "0.0.5005",
  AGENT_ACCOUNT_ID: "0.0.5004",
  AGENT_PRIVATE_KEY: AGENT_KEY,
};

function configError(load: () => unknown): ConfigError {
  try {
    load();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("loadReadOnlyConfig", () => {
  it("works with no environment at all, showing the reference deployment", () => {
    const reference = NETWORKS.testnet.reference;
    expect(loadReadOnlyConfig({})).toEqual({
      network: "testnet",
      rpcUrl: NETWORKS.testnet.rpcUrl,
      mirrorUrl: NETWORKS.testnet.mirrorUrl,
      vaultAddress: reference?.vault ?? null,
      topicId: reference?.topicId ?? null,
      agentAccountId: reference?.agentAccountId ?? null,
      agentAddress: null,
      baseToken: NETWORKS.testnet.baseToken,
      quoteToken: NETWORKS.testnet.quoteToken,
      poolFee: NETWORKS.testnet.defaultPoolFee,
      tickApiEnabled: false,
    });
  });

  it("never throws: invalid values fall back to the defaults", () => {
    const cfg = loadReadOnlyConfig({
      HEDERA_NETWORK: "moonnet",
      HEDERA_RPC_URL: "not a url",
      AUTONR_POOL_FEE: "cheap",
      AUTONR_VAULT_ADDRESS: "0x1234",
      AGENT_PRIVATE_KEY: "not-a-key",
      AUTONR_QUOTE_TOKEN: "{broken",
    });
    expect(cfg.network).toBe("testnet");
    expect(cfg.rpcUrl).toBe(NETWORKS.testnet.rpcUrl);
    expect(cfg.poolFee).toBe(3000);
    expect(cfg.vaultAddress).toBeNull();
    expect(cfg.agentAddress).toBeNull();
    expect(cfg.quoteToken).toEqual(NETWORKS.testnet.quoteToken);
  });

  it("reads the network, endpoints and deployment", () => {
    const cfg = loadReadOnlyConfig({
      ...tradingEnv,
      HEDERA_NETWORK: "mainnet",
      HEDERA_MIRROR_URL: "https://mirror.example.com/",
      AUTONR_ENABLE_TICK_API: "true",
    });
    expect(cfg.network).toBe("mainnet");
    expect(cfg.rpcUrl).toBe(NETWORKS.mainnet.rpcUrl);
    expect(cfg.mirrorUrl).toBe("https://mirror.example.com");
    expect(cfg.poolFee).toBe(NETWORKS.mainnet.defaultPoolFee);
    expect(cfg.vaultAddress).toBe(VAULT_ADDRESS);
    expect(cfg.topicId).toBe("0.0.5005");
    expect(cfg.agentAddress).toBe(privateKeyToAddress(AGENT_KEY));
    expect(cfg.tickApiEnabled).toBe(true);
  });

  it("replaces a token from JSON, keeping the role's pricing and deriving the address from the id", () => {
    const cfg = loadReadOnlyConfig({
      AUTONR_QUOTE_TOKEN: '{"symbol":"USDT","id":"0.0.1234","decimals":6,"supraPairId":48,"supraLabel":"USDT_USD"}',
    });
    expect(cfg.quoteToken).toEqual({
      ...NETWORKS.testnet.quoteToken,
      symbol: "USDT",
      id: "0.0.1234",
      address: longZeroAddress("0.0.1234"),
      decimals: 6,
      supraPairId: 48,
      supraLabel: "USDT_USD",
    });
  });
});

describe("loadAgentConfig", () => {
  it("lists every missing variable at once", () => {
    const error = configError(() => loadAgentConfig({}));
    expect(error.missing).toEqual(["AUTONR_VAULT_ADDRESS", "AUTONR_TOPIC_ID", "AGENT_ACCOUNT_ID", "AGENT_PRIVATE_KEY"]);
    expect(error.issues.every(issue => issue.problem.startsWith("not set"))).toBe(true);
  });

  it("never falls back to the reference deployment, whose vault only trusts its own agent", () => {
    const error = configError(() => loadAgentConfig({ AGENT_ACCOUNT_ID: "0.0.5004", AGENT_PRIVATE_KEY: AGENT_KEY }));
    expect(error.missing).toEqual(["AUTONR_VAULT_ADDRESS", "AUTONR_TOPIC_ID"]);
  });

  it("parses a complete environment with defaults for the tuning knobs", () => {
    const cfg = loadAgentConfig(tradingEnv);
    expect(cfg).toMatchObject({
      vaultAddress: VAULT_ADDRESS,
      agentAddress: privateKeyToAddress(AGENT_KEY),
      agentPrivateKey: AGENT_KEY,
      strategy: "rebalance",
      tradeUsd: 5,
      targetBaseWeight: 0.5,
      logHolds: true,
      llm: null,
    });
  });

  it("reads the tuning knobs", () => {
    const cfg = loadAgentConfig({
      ...tradingEnv,
      AUTONR_STRATEGY: "llm",
      ANTHROPIC_API_KEY: "test-key",
      AUTONR_TRADE_USD: "2.5",
      AUTONR_TARGET_BASE_WEIGHT: "0.3",
      AUTONR_LOG_HOLDS: "false",
    });
    expect(cfg).toMatchObject({
      strategy: "llm",
      tradeUsd: 2.5,
      targetBaseWeight: 0.3,
      logHolds: false,
      llm: { apiKey: "test-key", model: DEFAULT_LLM_MODEL },
    });
  });

  it("requires an API key for the llm strategy", () => {
    expect(configError(() => loadAgentConfig({ ...tradingEnv, AUTONR_STRATEGY: "llm" })).missing).toEqual([
      "ANTHROPIC_API_KEY",
    ]);
  });

  it("reports invalid values without echoing them", () => {
    const secret = "f".repeat(30);
    const error = configError(() =>
      loadAgentConfig({ ...tradingEnv, AGENT_PRIVATE_KEY: secret, AUTONR_TARGET_BASE_WEIGHT: "1.5" }),
    );
    expect(error.missing).toEqual(["AGENT_PRIVATE_KEY", "AUTONR_TARGET_BASE_WEIGHT"]);
    expect(error.message).not.toContain(secret);
  });

  it("rejects a key outside the secp256k1 range without quoting it", () => {
    const outOfRange = `0x${"ff".repeat(32)}`;
    const error = configError(() => loadAgentConfig({ ...tradingEnv, AGENT_PRIVATE_KEY: outOfRange }));
    expect(error.issues).toEqual([{ variable: "AGENT_PRIVATE_KEY", problem: "not a valid secp256k1 private key" }]);
    expect(error.message).not.toContain(BigInt(outOfRange).toString());
  });
});

describe("agent and operator credentials", () => {
  it("treats an agent with neither variable set as one for setup to create", () => {
    expect(loadAgentCredentials({})).toBeNull();
  });

  it("refuses half an agent", () => {
    expect(configError(() => loadAgentCredentials({ AGENT_ACCOUNT_ID: "0.0.5004" })).missing).toEqual([
      "AGENT_PRIVATE_KEY",
    ]);
  });

  it("requires both operator variables", () => {
    expect(configError(() => loadOperatorConfig({})).missing).toEqual(["OPERATOR_ACCOUNT_ID", "OPERATOR_PRIVATE_KEY"]);
    expect(loadOperatorConfig({ OPERATOR_ACCOUNT_ID: "0.0.2", OPERATOR_PRIVATE_KEY: AGENT_KEY }).address).toBe(
      privateKeyToAddress(AGENT_KEY),
    );
  });
});

describe("normalizeEcdsaPrivateKey", () => {
  const key = PrivateKey.generateECDSA();
  const raw = `0x${key.toStringRaw()}`;

  it("accepts raw hex with or without 0x", () => {
    expect(normalizeEcdsaPrivateKey(raw)).toBe(raw);
    expect(normalizeEcdsaPrivateKey(raw.slice(2).toUpperCase())).toBe(raw);
  });

  it("accepts the DER hex the Hedera Portal shows", () => {
    expect(key.toStringDer().startsWith("3030020100300706052b8104000a")).toBe(true);
    expect(normalizeEcdsaPrivateKey(key.toStringDer())).toBe(raw);
  });

  it("accepts SEC1 DER as exported by OpenSSL", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    const sec1 = privateKey.export({ format: "der", type: "sec1" }).toString("hex");
    const d = Buffer.from(privateKey.export({ format: "jwk" }).d ?? "", "base64url").toString("hex");
    expect(normalizeEcdsaPrivateKey(sec1)).toBe(`0x${d}`);
  });

  it("rejects ED25519 keys with an explanation", () => {
    expect(() => normalizeEcdsaPrivateKey(PrivateKey.generateED25519().toStringDer())).toThrow(/ED25519.*ECDSA/);
  });

  it("rejects text that is not a key", () => {
    expect(() => normalizeEcdsaPrivateKey("0xnot-hex")).toThrow("not a hex string");
    expect(() => normalizeEcdsaPrivateKey("abcd")).toThrow();
  });
});

describe("scriptCommand", () => {
  it("names the package manager that launched the process", () => {
    expect(scriptCommand("agent:setup", undefined, {})).toBe("npm run agent:setup");
    const env = { npm_config_user_agent: "pnpm/9.12.0 npm/? node/v22.11.0 darwin arm64" };
    expect(scriptCommand("verify", "0xabc", env)).toBe("pnpm run verify -- 0xabc");
  });
});
