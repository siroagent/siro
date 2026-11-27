import { describe, expect, it } from "vitest";
import { FEATURED, matchFeatured, normalize } from "../worker/discover";

describe("featured partners", () => {
  it("are https endpoints with a partner name", () => {
    for (const f of FEATURED) {
      expect(f.url, f.partner).toMatch(/^https:\/\//);
      expect(f.partner.length).toBeGreaterThan(1);
    }
  });

  it("match whole words only", () => {
    expect(matchFeatured("new token launches on Robinhood").map((f) => f.partner)).toContain("ApexFaucet");
    expect(matchFeatured("can I sell this token? honeypot").map((f) => f.partner)).toContain("ApexFaucet");
    expect(matchFeatured("weather in Paris")).toEqual([]);
    expect(matchFeatured("spooled exits")).toEqual([]);
  });

  it("read the price and networks from a v2 402", () => {
    const s = normalize({
      x402Version: 2,
      resource: "https://example.com/feed",
      description: "feed",
      accepts: [
        { scheme: "exact", network: "eip155:4663", asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", amount: "10000", payTo: "0x1" },
        { scheme: "exact", network: "eip155:56", asset: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d", amount: "10000000000000000", payTo: "0x1" },
      ],
      extensions: { bazaar: { info: { input: { method: "GET", queryParams: { limit: "20" } } } } },
    })!;
    expect(s.payable).toBe(true);
    expect(s.priceUsd).toBe(0.01);
    expect(s.networks).toEqual(["eip155:4663", "eip155:56"]);
    expect(s.input).toEqual({ limit: "20" });
  });
});
