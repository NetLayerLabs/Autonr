import { TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { type EncodedDecision } from "../decision";
import { type HederaClient } from "./client";

export type Publication = {
  topicId: string;
  sequence: number;
  /** Mirror Node format, "seconds.nanoseconds". */
  consensusTimestamp: string;
  /** SDK format, "0.0.1234@1727800000.123456789". */
  transactionId: string;
};

/**
 * Submits an encoded decision to the topic as the client's operator. The exact bytes go out unchanged: the vault later
 * receives keccak256 of these bytes, and a verifier re-hashes what the Mirror Node returns.
 */
export async function publishDecision(
  client: HederaClient,
  topicId: string,
  decision: EncodedDecision,
): Promise<Publication> {
  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(decision.bytes)
    // A trade cites exactly one sequence number; a chunked message would occupy several.
    .setMaxChunks(1)
    .execute(client);
  // The record carries both the sequence number and the consensus time, without waiting for the Mirror Node.
  const record = await response.getRecord(client);
  const sequence = record.receipt.topicSequenceNumber;
  if (!sequence) throw new Error(`topic ${topicId} returned no sequence number for ${response.transactionId}`);
  return {
    topicId,
    sequence: sequence.toNumber(),
    consensusTimestamp: record.consensusTimestamp.toString(),
    transactionId: response.transactionId.toString(),
  };
}
