import { type Hex } from "viem";

/** The Mirror Node answered 404: the entity, transaction or message does not exist there (or not yet). */
export class MirrorNotFoundError extends Error {
  constructor(readonly path: string) {
    super(`the Mirror Node has nothing at ${path}`);
    this.name = "MirrorNotFoundError";
  }
}

/** A request failed for good: a 4xx other than 404, or a 429/5xx/network failure that outlived every retry. */
export class MirrorRequestError extends Error {
  constructor(
    readonly path: string,
    /** HTTP status, or null when no response arrived (network error or timeout). */
    readonly status: number | null,
    detail: string,
  ) {
    super(`Mirror Node request ${path} failed${status === null ? "" : ` with HTTP ${status}`}: ${detail}`);
    this.name = "MirrorRequestError";
  }
}

/** `POST /api/v1/contracts/call` executed the call and the EVM reverted. `data` is the raw revert payload. */
export class ContractCallRevertedError extends Error {
  constructor(
    readonly data: Hex,
    readonly reason: string | null,
  ) {
    super(`contract call reverted${reason ? `: ${reason}` : ""}`);
    this.name = "ContractCallRevertedError";
  }
}

/** Resolves a 404 to null, for data whose absence the caller reports rather than fails on. */
export async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof MirrorNotFoundError) return null;
    throw error;
  }
}
