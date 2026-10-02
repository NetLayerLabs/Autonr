import { describe, expect, it } from "vitest";
import {
  clampRationale,
  DecisionTooLargeError,
  encodeDecisionFitting,
  MAX_DECISION_BYTES,
  type DecisionRecord,
} from "../src/decision";
import { tradeRecord } from "./verify/fixtures";

function fitted(rationale: string, overrides: Partial<DecisionRecord> = {}) {
  return encodeDecisionFitting(tradeRecord({ rationale, ...overrides }));
}

/** Large enough that the record overflows one HCS chunk unless the rationale is cut further than 400 characters. */
function bulkyMarket(): Partial<DecisionRecord> {
  const { market } = tradeRecord();
  return { strategy: { id: "x".repeat(32), version: "v".repeat(16), model: "m".repeat(48) }, market };
}

describe("clampRationale", () => {
  it("returns an empty string when there is no room for text", () => {
    expect(clampRationale("anything", 0)).toBe("");
    expect(clampRationale("anything", -5)).toBe("");
  });

  it("collapses whitespace and keeps short text intact", () => {
    expect(clampRationale("  hold \n\t steady  ", 400)).toBe("hold steady");
  });

  it("never splits a surrogate pair", () => {
    const clamped = clampRationale("🚀".repeat(10), 6);
    expect(clamped).toBe("🚀🚀…");
    expect(clamped.length).toBeLessThanOrEqual(6);
  });
});

describe("encodeDecisionFitting", () => {
  it.each([
    ["ASCII", "a"],
    ["CJK", "価"],
    ["emoji", "🚀"],
    ["quotes", '"'],
  ])("fits a %s rationale into one HCS chunk", (_label, unit) => {
    const encoded = fitted(unit.repeat(400), bulkyMarket());
    expect(encoded.bytes.length).toBeLessThanOrEqual(MAX_DECISION_BYTES);
    expect(encoded.record.rationale.endsWith("…")).toBe(true);
    // The cut lands on a code-point boundary: no replacement characters after a round trip.
    expect(new TextDecoder().decode(encoded.bytes)).not.toContain("�");
    expect([...encoded.record.rationale.slice(0, -1)].every(codePoint => codePoint === unit)).toBe(true);
  });

  it("keeps a rationale that already fits", () => {
    expect(fitted("Within 5% of the target weight; holding.").record.rationale).toBe(
      "Within 5% of the target weight; holding.",
    );
  });

  it("throws when the evidence alone exceeds the limit", () => {
    const rejection = { stage: "execution" as const, error: "E".repeat(64), detail: "d".repeat(200), decisionSeq: 1 };
    const oversized = tradeRecord({
      kind: "rejected",
      rationale: "refused",
      rejection,
      market: [
        { feed: "F".repeat(16), source: "chainlink", price: "9".repeat(300), updatedAt: 1 },
        { feed: "G".repeat(16), source: "supra", price: "9".repeat(300), updatedAt: 1 },
      ],
    });
    expect(() => encodeDecisionFitting(oversized)).toThrow(DecisionTooLargeError);
  });
});
