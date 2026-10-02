import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";
import { afterEach, describe, expect, it } from "vitest";
import { applyEnvUpdates, updateEnvFile } from "../src/env-file";

const original = [
  "# Network",
  "HEDERA_NETWORK=testnet",
  "",
  "# The agent",
  "AGENT_ACCOUNT_ID=",
  "export AGENT_PRIVATE_KEY=",
  "UNRELATED='kept $as is'",
  "AUTONR_TOPIC_ID=0.0.1",
  "AUTONR_TOPIC_ID=0.0.2",
  "",
].join("\n");

describe("applyEnvUpdates", () => {
  it("rewrites assignments in place and keeps every other line", () => {
    const updated = applyEnvUpdates(original, {
      AGENT_ACCOUNT_ID: "0.0.5004",
      AGENT_PRIVATE_KEY: "0xabc",
      AUTONR_TOPIC_ID: "0.0.5005",
    });
    expect(updated).toBe(
      [
        "# Network",
        "HEDERA_NETWORK=testnet",
        "",
        "# The agent",
        "AGENT_ACCOUNT_ID=0.0.5004",
        "export AGENT_PRIVATE_KEY=0xabc",
        "UNRELATED='kept $as is'",
        "AUTONR_TOPIC_ID=0.0.5005",
        "AUTONR_TOPIC_ID=0.0.5005",
        "",
      ].join("\n"),
    );
  });

  it("appends keys that are not there yet", () => {
    expect(applyEnvUpdates("A=1", { B: "2" })).toBe("A=1\nB=2\n");
    expect(applyEnvUpdates("", { B: "2" })).toBe("B=2\n");
  });

  it("quotes values only when dotenv needs it, and round-trips through dotenv", () => {
    const values = { PLAIN: "0.0.5004", SPACED: "two words", JSON: '{"symbol":"USDT"}', MIXED: `it's "quoted"` };
    const updated = applyEnvUpdates("", { PLAIN: values.PLAIN, SPACED: values.SPACED, JSON: values.JSON });
    expect(updated).toContain("PLAIN=0.0.5004\n");
    expect(parse(updated)).toEqual({ PLAIN: values.PLAIN, SPACED: values.SPACED, JSON: values.JSON });
    expect(() => applyEnvUpdates("", { MIXED: values.MIXED })).toThrow(/quote/);
  });

  it("keeps Windows line endings", () => {
    expect(applyEnvUpdates("A=1\r\nB=2\r\n", { B: "3" })).toBe("A=1\r\nB=3\r\n");
  });
});

describe("updateEnvFile", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("creates a missing file readable only by its owner, then updates it", async () => {
    dir = await mkdtemp(join(tmpdir(), "autonr-env-"));
    const path = join(dir, ".env");
    await updateEnvFile(path, { AGENT_ACCOUNT_ID: "0.0.5004" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await updateEnvFile(path, { AUTONR_TOPIC_ID: "0.0.5005" });
    expect(parse(await readFile(path, "utf8"))).toEqual({ AGENT_ACCOUNT_ID: "0.0.5004", AUTONR_TOPIC_ID: "0.0.5005" });
  });
});
