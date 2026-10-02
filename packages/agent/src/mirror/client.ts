import { type Address, type Hex, isHex, numberToHex } from "viem";
import { z } from "zod";
import { ContractCallRevertedError, MirrorNotFoundError, MirrorRequestError } from "./errors";
import {
  type Account,
  accountSchema,
  blocksPageSchema,
  type ContractAction,
  contractActionsPageSchema,
  contractCallSchema,
  type ContractInfo,
  type ContractLog,
  contractLogsPageSchema,
  type ContractResult,
  contractResultSchema,
  contractSchema,
  errorSchema,
  tokenRelationshipsSchema,
  type Topic,
  type TopicMessage,
  topicMessageSchema,
  topicMessagesPageSchema,
  topicSchema,
  transactionsPageSchema,
} from "./schemas";

/** The largest page the Mirror Node serves. */
const MAX_PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 15_000;
/** Upper bound for a server-sent Retry-After, so a misconfigured proxy cannot stall a CLI for minutes. */
const MAX_RETRY_AFTER_MS = 10_000;

type MirrorClientOptions = {
  /** REST root, e.g. https://testnet.mirrornode.hedera.com */
  baseUrl: string;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Attempts per request including the first; 429 and 5xx responses and network errors are retried. */
  attempts?: number;
  /** Delay before the first retry; it doubles on every further retry. */
  retryDelayMs?: number;
};

type ContractCallRequest = { to: Address; data: Hex; from?: Address; block: number | "latest" };

/**
 * Typed, read-only client for the Hedera Mirror Node REST API. Public Mirror Nodes rate-limit aggressively and
 * historical `contracts/call` requests occasionally fail with a transient FAIL_INVALID (HTTP 500), so every request is
 * retried with exponential backoff before it surfaces as a MirrorRequestError. A 404 is never retried: it becomes a
 * MirrorNotFoundError for the caller to interpret (unknown entity, or data the node has not imported yet).
 */
export class MirrorClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly attempts: number;
  private readonly retryDelayMs: number;

  constructor(options: MirrorClientOptions) {
    // Hedera docs often quote the REST root with its /api/v1 suffix; every path below adds it itself.
    this.baseUrl = options.baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
    // Looked up on every call rather than captured: browsers reject a detached `fetch` with "Illegal invocation".
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.attempts = Math.max(1, options.attempts ?? 4);
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  /** Result of a contract transaction, by EVM transaction hash or Mirror Node transaction id (`0.0.x-sss-nnn`). */
  contractResult(txHashOrId: string): Promise<ContractResult> {
    return this.get(`/api/v1/contracts/results/${txHashOrId}`, contractResultSchema);
  }

  /** Every call frame of a contract transaction, in execution order. */
  async contractActions(txHashOrId: string): Promise<ContractAction[]> {
    const actions: ContractAction[] = [];
    const path = `/api/v1/contracts/results/${txHashOrId}/actions?order=asc&limit=${MAX_PAGE_SIZE}`;
    for await (const page of this.pages(path, contractActionsPageSchema)) actions.push(...page.actions);
    return actions.sort((a, b) => a.index - b.index);
  }

  /**
   * Logs emitted by one contract, newest first, optionally only those at or after the consensus timestamp `since`.
   * Fetched page by page as the caller iterates. Not filtered by event topic on purpose: the Mirror Node only filters
   * by topic inside a timestamp window of at most 7 days.
   */
  async *contractLogs(contract: string, since?: string): AsyncGenerator<ContractLog> {
    const from = since ? `&timestamp=gte:${since}` : "";
    const path = `/api/v1/contracts/${contract}/results/logs?order=desc&limit=${MAX_PAGE_SIZE}${from}`;
    for await (const page of this.pages(path, contractLogsPageSchema)) yield* page.logs;
  }

  contract(idOrAddress: string): Promise<ContractInfo> {
    return this.get(`/api/v1/contracts/${idOrAddress}`, contractSchema);
  }

  /** An account by id or EVM address; `at` (a consensus timestamp) returns its state as of that moment. */
  account(idOrEvmAddress: string, at?: string): Promise<Account> {
    const query = at ? `&timestamp=lte:${at}` : "";
    return this.get(`/api/v1/accounts/${idOrEvmAddress}?transactions=false${query}`, accountSchema);
  }

  /**
   * An account's balance of an HTS token in its smallest unit, or null when the account is not associated with the
   * token: Hedera rejects any transfer of a token to an account that is not associated with it.
   */
  async tokenBalance(idOrEvmAddress: string, tokenId: string): Promise<bigint | null> {
    const path = `/api/v1/accounts/${idOrEvmAddress}/tokens?token.id=${tokenId}`;
    const { tokens } = await this.get(path, tokenRelationshipsSchema);
    const relationship = tokens.find(token => token.token_id === tokenId);
    return relationship ? BigInt(relationship.balance) : null;
  }

  /** The newest block the Mirror Node has imported, with the consensus timestamp it closed at; null when it has none. */
  async latestBlock(): Promise<{ number: number; closedAt: string } | null> {
    const { blocks } = await this.get("/api/v1/blocks?limit=1&order=desc", blocksPageSchema);
    const [block] = blocks;
    return block ? { number: block.number, closedAt: block.timestamp.to } : null;
  }

  topic(topicId: string): Promise<Topic> {
    return this.get(`/api/v1/topics/${topicId}`, topicSchema);
  }

  topicMessage(topicId: string, sequence: number): Promise<TopicMessage> {
    return this.get(`/api/v1/topics/${topicId}/messages/${sequence}`, topicMessageSchema);
  }

  /** The latest `limit` messages of a topic, newest first. */
  async topicMessages(topicId: string, limit: number): Promise<TopicMessage[]> {
    const messages: TopicMessage[] = [];
    const path = `/api/v1/topics/${topicId}/messages?order=desc&limit=${Math.min(limit, MAX_PAGE_SIZE)}`;
    for await (const page of this.pages(path, topicMessagesPageSchema)) {
      messages.push(...page.messages);
      if (messages.length >= limit) break;
    }
    return messages.slice(0, limit);
  }

  /** Hedera transaction id (`0.0.x-sss-nnn`) of the transaction that reached consensus at `consensusTimestamp`. */
  async transactionIdAt(consensusTimestamp: string): Promise<string | null> {
    const page = await this.get(`/api/v1/transactions?timestamp=${consensusTimestamp}`, transactionsPageSchema);
    return page.transactions[0]?.transaction_id ?? null;
  }

  /**
   * Executes a read-only call. With a block number the Mirror Node re-executes it against the state at the end of that
   * block, which is what lets anyone re-check a past trade without an archive node.
   */
  async call({ to, data, from, block }: ContractCallRequest): Promise<Hex> {
    const path = "/api/v1/contracts/call";
    const response = await this.send(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ to, data, from, block: block === "latest" ? block : numberToHex(block), estimate: false }),
    });
    const body = await readBody(path, response);
    if (response.ok) return parse(path, response.status, contractCallSchema, body).result;
    const revert = errorSchema
      .safeParse(body)
      .data?._status.messages.find(message => message.message === "CONTRACT_REVERT_EXECUTED");
    if (revert) throw new ContractCallRevertedError(isHex(revert.data) ? revert.data : "0x", revert.detail || null);
    throw new MirrorRequestError(path, response.status, describeErrorBody(body));
  }

  private async *pages<T extends { links: { next: string | null } }>(
    firstPath: string,
    schema: z.ZodType<T>,
  ): AsyncGenerator<T> {
    let path: string | null = firstPath;
    while (path) {
      const page: T = await this.get(path, schema);
      yield page;
      // links.next is a root-relative path ("/api/v1/..."), so it composes with the base URL as is.
      path = page.links.next;
    }
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await this.send(path, { method: "GET", headers: { accept: "application/json" } });
    const body = await readBody(path, response);
    if (!response.ok) throw new MirrorRequestError(path, response.status, describeErrorBody(body));
    return parse(path, response.status, schema, body);
  }

  /** Sends with retries. Returns the final response unless it is a 404, which throws MirrorNotFoundError. */
  private async send(path: string, init: RequestInit): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (attempt >= this.attempts) {
          throw new MirrorRequestError(path, null, error instanceof Error ? error.message : String(error));
        }
        await sleep(this.backoffMs(attempt, null));
        continue;
      }
      if (response.status === 404) throw new MirrorNotFoundError(path);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= this.attempts) return response;
      await sleep(this.backoffMs(attempt, response.headers.get("retry-after")));
    }
  }

  private backoffMs(attempt: number, retryAfter: string | null): number {
    const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    return this.retryDelayMs * 2 ** (attempt - 1);
  }
}

async function readBody(path: string, response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new MirrorRequestError(path, response.status, `expected JSON, got: ${text.slice(0, 120)}`);
  }
}

function parse<T>(path: string, status: number, schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new MirrorRequestError(path, status, `unexpected response shape:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function describeErrorBody(body: unknown): string {
  const messages = errorSchema.safeParse(body).data?._status.messages;
  if (!messages?.length) return JSON.stringify(body).slice(0, 200);
  return messages.map(message => [message.message, message.detail].filter(Boolean).join(": ")).join("; ");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
