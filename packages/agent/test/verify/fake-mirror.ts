import { type Address, type Hex } from "viem";

type CallOutcome = { result: Hex } | { revert: Hex } | { status: number; message: string };
type CallBody = { to: Address; data: Hex; from?: Address; block: string; estimate: boolean };

/**
 * An in-memory Mirror Node for offline tests. GET routes match on path plus query first, then on the path alone, so a
 * test only spells out the query when it matters (pagination). Anything unregistered answers 404, which is exactly how
 * the real Mirror Node reports data it does not have (yet).
 */
export class FakeMirror {
  readonly requests: string[] = [];
  readonly contractCallBodies: CallBody[] = [];
  private readonly routes = new Map<string, unknown>();
  private readonly calls = new Map<string, CallOutcome>();
  private callFailure: CallOutcome | null = null;

  route(pathAndQuery: string, body: unknown): this {
    this.routes.set(pathAndQuery.toLowerCase(), body);
    return this;
  }

  unroute(pathAndQuery: string): this {
    this.routes.delete(pathAndQuery.toLowerCase());
    return this;
  }

  /** Answers `POST /api/v1/contracts/call` for `data` sent to `to` at `block`. */
  contractCall(to: Address, data: Hex, block: number | "latest", outcome: CallOutcome): this {
    this.calls.set(callKey(to, data, block), outcome);
    return this;
  }

  /** Makes every contract call fail the same way, e.g. while the Mirror Node has not imported a block yet. */
  failContractCalls(outcome: CallOutcome): this {
    this.callFailure = outcome;
    return this;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const pathAndQuery = `${url.pathname}${url.search}`;
    this.requests.push(`${init?.method ?? "GET"} ${pathAndQuery}`);
    if (init?.method === "POST" && url.pathname === "/api/v1/contracts/call") {
      const body = JSON.parse(String(init.body)) as CallBody;
      this.contractCallBodies.push(body);
      const block = body.block === "latest" ? body.block : Number(body.block);
      const outcome = this.callFailure ?? this.calls.get(callKey(body.to, body.data, block));
      return callResponse(outcome);
    }
    const key = pathAndQuery.toLowerCase();
    const body = this.routes.has(key) ? this.routes.get(key) : this.routes.get(url.pathname.toLowerCase());
    return body === undefined ? notFound() : json(200, body);
  };
}

function callKey(to: Address, data: Hex, block: number | "latest"): string {
  return `${to}|${data}|${block}`.toLowerCase();
}

function callResponse(outcome: CallOutcome | undefined): Response {
  if (!outcome) return notFound();
  if ("result" in outcome) return json(200, { result: outcome.result });
  if ("revert" in outcome) {
    return json(400, {
      _status: { messages: [{ message: "CONTRACT_REVERT_EXECUTED", detail: "", data: outcome.revert }] },
    });
  }
  return json(outcome.status, { _status: { messages: [{ message: outcome.message, detail: "", data: "" }] } });
}

function notFound(): Response {
  return json(404, { _status: { messages: [{ message: "Not found" }] } });
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
