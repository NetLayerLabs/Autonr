import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { pricingOf } from "../src/oracles/snapshot";
import { whbar } from "./fixtures";

describe("pricingOf", () => {
  it("follows the vault's token configuration, not the network defaults", () => {
    expect(pricingOf({ chainlinkFeed: zeroAddress, supraPairId: 48, supraEnabled: true })).toEqual({
      chainlinkFeed: null,
      supraPairId: 48,
    });
    const feed = whbar.chainlinkFeed!;
    expect(pricingOf({ chainlinkFeed: feed, supraPairId: 75, supraEnabled: false })).toEqual({
      chainlinkFeed: feed,
      supraPairId: null,
    });
  });
});
