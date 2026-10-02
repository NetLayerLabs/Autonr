import type { ApiErrorBody } from "./types";

/** A non-2xx answer from one of the dashboard's API routes, carrying the route's own explanation. */
class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function getJson<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path, { cache: "no-store" }));
}

export async function postJson<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return parse<T>(response);
}

/** Bad input (4xx) will not fix itself; upstream failures (502) and network errors are worth one more try. */
export function shouldRetry(failureCount: number, error: Error): boolean {
  return !(error instanceof ApiError && error.status < 500) && failureCount < 2;
}

// The routes are typed end to end (see ./types), so the body is trusted to match T once the status is OK.
async function parse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(body) ?? `The dashboard API answered HTTP ${response.status}.`);
  }
  return body as T;
}

function errorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const { error } = body as ApiErrorBody;
  return typeof error === "string" ? error : null;
}
