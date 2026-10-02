import type { TradeEvidence } from "~~/lib/api/types";

type Tampering = {
  id: string;
  title: string;
  description: string;
  /** A modified copy of the evidence, or null when the evidence lacks what this tampering changes. */
  apply: (evidence: TradeEvidence) => TradeEvidence | null;
};

/** secp256k1 generator point, i.e. the public key of private key 1: a valid key that is certainly not the agent's. */
const FOREIGN_SUBMIT_KEY = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

const RATIONALE_KEY = '"rationale":"';

/**
 * Flips the ASCII case bit of one letter of the rationale. The JSON stays valid and says the same thing to a human,
 * so only the hash commitment can notice. atob/btoa work on "binary strings" with one character per byte, which keeps
 * this an exact one-byte change even when the message holds multi-byte UTF-8 text.
 */
function flipOneByte(evidence: TradeEvidence): TradeEvidence | null {
  if (!evidence.message) return null;
  const bytes = atob(evidence.message.raw);
  const keyAt = bytes.indexOf(RATIONALE_KEY);
  const from = keyAt === -1 ? 0 : keyAt + RATIONALE_KEY.length;
  const offset = bytes.slice(from).search(/[A-Za-z]/);
  // An empty rationale leaves no letter to flip there; any other letter still changes exactly one byte.
  const index = offset === -1 ? bytes.search(/[A-Za-z]/) : from + offset;
  if (index === -1) return null;
  const flipped = String.fromCharCode(bytes.charCodeAt(index) ^ 0x20);
  const raw = btoa(bytes.slice(0, index) + flipped + bytes.slice(index + 1));
  return { ...evidence, message: { ...evidence.message, raw } };
}

/** Changes the vault's last code byte (inside the compiler metadata, never an immutable), as a lookalike would differ. */
function swapVaultCode(evidence: TradeEvidence): TradeEvidence | null {
  const code = evidence.vaultCode;
  if (!code) return null;
  const vaultCode = `0x${code.slice(2, -2)}${code.endsWith("00") ? "01" : "00"}` as const;
  return { ...evidence, vaultCode };
}

function changeAmountIn(evidence: TradeEvidence): TradeEvidence {
  const amountIn = (BigInt(evidence.receipt.amountIn) + 1n).toString();
  return { ...evidence, receipt: { ...evidence.receipt, amountIn } };
}

function moveMessageAfterTrade(evidence: TradeEvidence): TradeEvidence | null {
  if (!evidence.message) return null;
  const [seconds = "0", nanos = "0"] = evidence.consensusTimestamp.split(".");
  const consensusTimestamp = `${BigInt(seconds) + 1n}.${nanos.padEnd(9, "0")}`;
  return { ...evidence, message: { ...evidence.message, consensusTimestamp } };
}

function swapSubmitKey(evidence: TradeEvidence): TradeEvidence | null {
  if (!evidence.message) return null;
  const topicSubmitKey = { type: "ECDSA_SECP256K1", key: FOREIGN_SUBMIT_KEY };
  return { ...evidence, message: { ...evidence.message, topicSubmitKey } };
}

export const TAMPERINGS: Tampering[] = [
  {
    id: "flip-byte",
    title: "Flip one byte of the message",
    description: "Changes the case of one letter in the published rationale. The JSON still parses.",
    apply: flipOneByte,
  },
  {
    id: "lookalike-vault",
    title: "Emit from a lookalike contract",
    description: "Changes one byte of the emitting contract's code, as a contract that only imitates AgentVault would.",
    apply: swapVaultCode,
  },
  {
    id: "amount-in",
    title: "Change amountIn",
    description: "Pretends the vault sold one smallest unit more than the agent announced.",
    apply: changeAmountIn,
  },
  {
    id: "late-message",
    title: "Move the message after the trade",
    description: "Gives the decision a consensus timestamp one second after the trade.",
    apply: moveMessageAfterTrade,
  },
  {
    id: "submit-key",
    title: "Swap the submit key",
    description: "Replaces the topic's submit key with a key the agent does not hold.",
    apply: swapSubmitKey,
  },
];
