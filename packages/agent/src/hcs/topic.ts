import { type PublicKey, TopicCreateTransaction } from "@hiero-ledger/sdk";
import { type HederaClient } from "./client";

const DECISION_TOPIC_MEMO = "autonr decisions";

/**
 * Creates the decision topic with the operator (vault owner) as payer and admin. The submit key is the agent's public
 * key, so only the agent can write to the log; the owner can update or delete the topic but cannot post decisions.
 */
export async function createDecisionTopic(operator: HederaClient, agentKey: PublicKey): Promise<string> {
  const adminKey = operator.operatorPublicKey;
  if (!adminKey) throw new Error("the operator client has no operator key");
  const response = await new TopicCreateTransaction()
    .setTopicMemo(DECISION_TOPIC_MEMO)
    .setSubmitKey(agentKey)
    .setAdminKey(adminKey)
    .execute(operator);
  const { topicId } = await response.getReceipt(operator);
  if (!topicId) throw new Error(`topic creation ${response.transactionId} returned no topic id`);
  return topicId.toString();
}
