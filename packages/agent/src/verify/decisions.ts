import { decodeDecision } from "../decision";
import { type TopicMessage } from "../mirror";
import { type NetworkName } from "../networks";
import { messageBytes, messageText } from "./evaluate";
import { DEFAULT_LIST_LIMIT, limitInput, mirrorFor, topicIdInput } from "./input";
import { type DecisionEntry } from "./types";

/**
 * The latest decisions on a topic, newest first. Messages that are not valid decision records are returned with their
 * error, never dropped. A topic id that does not exist yields an empty list, as the Mirror Node reports it.
 */
export async function listDecisions(input: {
  network: NetworkName;
  topicId: string;
  limit?: number;
  mirrorUrl?: string;
}): Promise<DecisionEntry[]> {
  const topicId = topicIdInput(input.topicId);
  const limit = limitInput(input.limit, DEFAULT_LIST_LIMIT);
  const messages = await mirrorFor(input.network, input.mirrorUrl).topicMessages(topicId, limit);
  return messages.map(decisionEntry);
}

export function decisionEntry(message: TopicMessage): DecisionEntry {
  const bytes = messageBytes(message.message);
  const decoded = decodeDecision(bytes);
  return {
    sequence: message.sequence_number,
    consensusTimestamp: message.consensus_timestamp,
    payer: message.payer_account_id,
    hash: decoded.hash,
    record: decoded.ok ? decoded.record : null,
    error: decoded.ok ? null : decoded.error,
    raw: messageText(bytes),
  };
}
