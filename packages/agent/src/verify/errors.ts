/**
 * - invalid-input: the request itself is malformed (bad transaction id, topic id, limit…).
 * - not-found: the Mirror Node has no such transaction, topic or message.
 * - not-a-trade: the transaction exists but emitted no AgentVault TradeExecuted event.
 * - not-replayable: the message is not a rejected decision that carries replay data.
 * Mirror Node outages surface separately as MirrorRequestError.
 */
export type VerifyErrorCode = "invalid-input" | "not-found" | "not-a-trade" | "not-replayable";

/** A request the verifier cannot answer, with a message written for the person who made it. */
export class VerifyError extends Error {
  constructor(
    readonly code: VerifyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VerifyError";
  }
}
