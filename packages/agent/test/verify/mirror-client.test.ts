import { describe, expect, it, vi } from "vitest";
import { ContractCallRevertedError, MirrorClient, MirrorNotFoundError, MirrorRequestError } from "../../src/mirror";
import { json } from "./fake-mirror";

const TOPIC = { topic_id: "0.0.6300001", created_timestamp: "1789990000.000000000", deleted: false, submit_key: null };
const CALL = { to: "0x0000000000000000000000000000000000001549", data: "0x313ce567", block: 41_000_000 } as const;
const VAULT_LOGS = "/api/v1/contracts/0x5fbdb2315678afecb367f032d93f642f64180aa3/results/logs";

function clientWith(...responses: (Response | Error)[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetch.mockRejectedValueOnce(response);
    else fetch.mockResolvedValueOnce(response);
  }
  return { fetch, client: new MirrorClient({ baseUrl: "https://mirror.test/api/v1/", fetch, retryDelayMs: 0 }) };
}

function mirrorError(status: number, message: string, data = "") {
  return json(status, { _status: { messages: [{ message, detail: "", data }] } });
}

describe("MirrorClient", () => {
  it("retries rate limits and transient server errors before answering", async () => {
    const { client, fetch } = clientWith(
      new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
      mirrorError(500, "FAIL_INVALID"),
      new TypeError("fetch failed"),
      json(200, TOPIC),
    );

    await expect(client.topic("0.0.6300001")).resolves.toMatchObject({ topic_id: "0.0.6300001" });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://mirror.test/api/v1/topics/0.0.6300001");
  });

  it("gives up after its attempts with the last status", async () => {
    const { client } = clientWith(...Array.from({ length: 4 }, () => mirrorError(503, "Service Unavailable")));
    const request = client.topic("0.0.6300001");
    await expect(request).rejects.toBeInstanceOf(MirrorRequestError);
    await expect(request).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("Service Unavailable"),
    });
  });

  it("turns a 404 into MirrorNotFoundError without retrying", async () => {
    const { client, fetch } = clientWith(mirrorError(404, "Not found"));
    await expect(client.topicMessage("0.0.6300001", 9)).rejects.toBeInstanceOf(MirrorNotFoundError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a response that does not have the documented shape", async () => {
    const { client } = clientWith(json(200, { topic_id: 6300001 }));
    await expect(client.topic("0.0.6300001")).rejects.toMatchObject({
      message: expect.stringContaining("unexpected response shape"),
    });
  });

  it("executes historical calls with a hex block number and surfaces reverts with their data", async () => {
    const { client, fetch } = clientWith(
      json(200, { result: "0x0000000000000000000000000000000000000000000000000000000000000006" }),
      mirrorError(400, "CONTRACT_REVERT_EXECUTED", "0x8c4be7e5"),
      mirrorError(400, "Bad Request: Unknown block number"),
    );

    await expect(client.call(CALL)).resolves.toBe("0x0000000000000000000000000000000000000000000000000000000000000006");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      to: CALL.to,
      data: CALL.data,
      block: "0x2719c40",
      estimate: false,
    });
    const revert = client.call(CALL);
    await expect(revert).rejects.toBeInstanceOf(ContractCallRevertedError);
    await expect(revert).rejects.toMatchObject({ data: "0x8c4be7e5" });
    await expect(client.call(CALL)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("Unknown block number"),
    });
  });

  it("reads a token balance, and null for a token the account is not associated with", async () => {
    const vault = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
    const { client, fetch } = clientWith(
      json(200, { tokens: [{ token_id: "0.0.15058", balance: 4_880_429_477 }], links: { next: null } }),
      json(200, { tokens: [], links: { next: null } }),
    );

    await expect(client.tokenBalance(vault, "0.0.15058")).resolves.toBe(4_880_429_477n);
    await expect(client.tokenBalance(vault, "0.0.5449")).resolves.toBeNull();
    expect(fetch.mock.calls[1]?.[0]).toBe(`https://mirror.test/api/v1/accounts/${vault}/tokens?token.id=0.0.5449`);
  });

  it("reads the newest block and when it closed", async () => {
    const block = { number: 41_233_019, timestamp: { from: "1790000000.000000001", to: "1790000001.999999999" } };
    const { client } = clientWith(json(200, { blocks: [block], links: { next: null } }), json(200, { blocks: [] }));

    await expect(client.latestBlock()).resolves.toEqual({ number: 41_233_019, closedAt: "1790000001.999999999" });
    await expect(client.latestBlock()).resolves.toBeNull();
  });

  it("pages through contract logs from a timestamp on, as long as the caller iterates", async () => {
    const log = (index: number) => ({
      address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
      contract_id: "0.0.6100001",
      data: "0x",
      index,
      topics: [],
      block_number: 1,
      timestamp: `1790000000.00000000${index}`,
      transaction_hash: `0x${"ab".repeat(32)}`,
    });
    const next = `${VAULT_LOGS}?page=2`;
    const { client, fetch } = clientWith(
      json(200, { logs: [log(3), log(2)], links: { next } }),
      json(200, { logs: [log(1)], links: { next: "/api/v1/never-requested" } }),
    );

    const seen: string[] = [];
    for await (const entry of client.contractLogs("0x5fbdb2315678afecb367f032d93f642f64180aa3", "1789990000.0")) {
      seen.push(entry.timestamp);
      if (seen.length === 3) break;
    }

    expect(seen).toEqual(["1790000000.000000003", "1790000000.000000002", "1790000000.000000001"]);
    const firstPage = `${VAULT_LOGS}?order=desc&limit=100&timestamp=gte:1789990000.0`;
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      `https://mirror.test${firstPage}`,
      `https://mirror.test${next}`,
    ]);
  });
});
