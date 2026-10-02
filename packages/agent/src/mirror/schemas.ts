import { type Address, getAddress, type Hex } from "viem";
import { z } from "zod";

/**
 * Only the Mirror Node fields Autonr reads are declared; zod drops the rest, so fields the Mirror Node adds later
 * never break parsing. Shapes were checked against live testnet responses (2026-10-01).
 */

const hex = z.string().refine((value): value is Hex => /^0x[0-9a-fA-F]*$/.test(value), "expected 0x-prefixed hex");

/** The OpenAPI spec allows EVM addresses without the 0x prefix, so normalise every address to checksummed form. */
const evmAddress = z
  .string()
  .regex(/^(0x)?[0-9a-fA-F]{40}$/, "expected a 20-byte EVM address")
  .transform((value): Address => getAddress(value.startsWith("0x") ? value : `0x${value}`));

const entityId = z.string().regex(/^\d+\.\d+\.\d+$/, "expected a Hedera entity id");

/** "seconds.nanoseconds"; kept as a string because a double cannot hold nanosecond precision. */
const consensusTimestamp = z.string().regex(/^\d+\.\d{1,9}$/, "expected a consensus timestamp");

const links = z.object({ next: z.string().nullable() });

const keySchema = z.object({ _type: z.string(), key: z.string() });

const resultLogSchema = z.object({
  /** EVM address of the emitting contract (its CREATE address when it has one, unlike `contract_id`). */
  address: evmAddress,
  contract_id: entityId,
  data: hex.nullable(),
  topics: z.array(hex),
});

export const contractResultSchema = z.object({
  /** EVM address of the called contract. */
  address: evmAddress.nullable(),
  block_number: z.number().int().nullable(),
  contract_id: entityId.nullable(),
  /** For a reverted call: the revert data as hex, or a Hedera status name. Null on success. */
  error_message: z.string().nullish(),
  /** The sender as a long-zero address, even for EthereumTransactions signed by an alias (ECDSA) account. */
  from: evmAddress.nullable(),
  /** Full calldata of the top-level call, selector included. */
  function_parameters: hex.nullable(),
  hash: hex,
  result: z.string(),
  timestamp: consensusTimestamp,
  logs: z.array(resultLogSchema),
});

export const contractActionsPageSchema = z.object({
  actions: z.array(
    z.object({
      index: z.number().int(),
      call_depth: z.number().int(),
      /** Entity ids, unlike `from`/`to`, which are long-zero addresses even for contracts that have an EVM address. */
      caller: entityId,
      recipient: entityId.nullable(),
      from: evmAddress,
      to: evmAddress.nullable(),
      input: hex.nullable(),
      result_data_type: z.string(),
    }),
  ),
  links,
});

export const contractLogsPageSchema = z.object({
  logs: z.array(
    resultLogSchema.extend({
      block_number: z.number().int(),
      timestamp: consensusTimestamp,
      transaction_hash: hex,
    }),
  ),
  links,
});

export const topicSchema = z.object({
  topic_id: entityId,
  created_timestamp: consensusTimestamp.nullable(),
  deleted: z.boolean().nullable(),
  submit_key: keySchema.nullable(),
});

export const topicMessageSchema = z.object({
  consensus_timestamp: consensusTimestamp,
  /** Base64 of the exact message bytes. */
  message: z.base64(),
  payer_account_id: entityId,
  sequence_number: z.number().int(),
});

export const topicMessagesPageSchema = z.object({ messages: z.array(topicMessageSchema), links });

export const accountSchema = z.object({
  account: entityId,
  evm_address: evmAddress.nullable(),
  /** Null for hollow accounts, which have an EVM address but have not signed anything yet. */
  key: keySchema.nullable(),
});

export const contractSchema = z.object({
  contract_id: entityId,
  evm_address: evmAddress,
  /** The deployed code, with immutables filled in; null or absent while the Mirror Node has not imported it. */
  runtime_bytecode: hex.nullish(),
});

/** An account's token relationships; a token is listed only while the account is associated with it. */
export const tokenRelationshipsSchema = z.object({
  tokens: z.array(z.object({ token_id: entityId, balance: z.number().int().nonnegative() })),
});

export const blocksPageSchema = z.object({
  blocks: z.array(z.object({ number: z.number().int(), timestamp: z.object({ to: consensusTimestamp }) })),
});

export const transactionsPageSchema = z.object({ transactions: z.array(z.object({ transaction_id: z.string() })) });

export const contractCallSchema = z.object({ result: hex });

export const errorSchema = z.object({
  _status: z.object({
    messages: z.array(z.object({ message: z.string(), detail: z.string().nullish(), data: z.string().nullish() })),
  }),
});

export type ContractResult = z.infer<typeof contractResultSchema>;
export type ContractAction = z.infer<typeof contractActionsPageSchema>["actions"][number];
export type ContractLog = z.infer<typeof contractLogsPageSchema>["logs"][number];
export type Topic = z.infer<typeof topicSchema>;
export type TopicMessage = z.infer<typeof topicMessageSchema>;
export type Account = z.infer<typeof accountSchema>;
export type ContractInfo = z.infer<typeof contractSchema>;
