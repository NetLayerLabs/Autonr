import { describe, expect, it } from "vitest";
import { withGasHeadroom } from "../src/chain";

describe("withGasHeadroom", () => {
  it("adds 30% to the relay's estimate", () => {
    expect(withGasHeadroom(400_000n)).toBe(520_000n);
  });

  it("caps the limit at 3,000,000 gas", () => {
    expect(withGasHeadroom(2_500_000n)).toBe(3_000_000n);
  });

  it("refuses an estimate the cap cannot cover instead of sending a transaction bound to run out of gas", () => {
    expect(() => withGasHeadroom(3_000_001n)).toThrow(RangeError);
  });
});
