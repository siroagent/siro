import { describe, expect, it } from "vitest";
import { CATEGORIES, PAY_KEYS, PAY_NETWORKS, RESOURCES, byId, formatPrice, isPayKey, payNetworkOf, toUnits } from "../shared/catalog";

describe("catalog", () => {
  it("lists every resource once, with a known category and a positive price", () => {
    const ids = RESOURCES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RESOURCES) {
      expect(Object.keys(CATEGORIES)).toContain(r.category);
      expect(r.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(Number(r.price)).toBeGreaterThan(0);
      expect(r.price).toMatch(/^\d+(\.\d{1,6})?$/);
    }
  });

  it("keeps every field name unique within a resource and marks enums with their options", () => {
    for (const r of RESOURCES) {
      const names = r.fields.map((f) => f.name);
      expect(new Set(names).size, r.id).toBe(names.length);
      for (const f of r.fields) if (f.type === "enum") expect(f.options?.length, `${r.id}.${f.name}`).toBeGreaterThan(0);
    }
  });

  it("finds a resource by id and nothing for an unknown id", () => {
    expect(byId("gas-now")?.price).toBe("0.001");
    expect(byId("no-such-tool")).toBeUndefined();
  });
});

describe("toUnits", () => {
  it("converts a USD string to 6-decimal base units without float error", () => {
    expect(toUnits("0.001")).toBe(1000n);
    expect(toUnits("0.02")).toBe(20000n);
    expect(toUnits("0.95")).toBe(950000n);
    expect(toUnits("1")).toBe(1000000n);
    expect(toUnits("12.345678")).toBe(12345678n);
  });

  it("drops precision past six decimals instead of rounding up", () => {
    expect(toUnits("0.0000019")).toBe(1n);
  });

  it("agrees with every catalog price", () => {
    for (const r of RESOURCES) expect(Number(toUnits(r.price)) / 1e6).toBeCloseTo(Number(r.price), 9);
  });
});

describe("formatPrice", () => {
  it("shows at least two decimals and no trailing zeros past them", () => {
    expect(formatPrice("0.60")).toBe("$0.60");
    expect(formatPrice("0.045")).toBe("$0.045");
    expect(formatPrice("0.001")).toBe("$0.001");
    expect(formatPrice("1")).toBe("$1.00");
  });
});

describe("payment networks", () => {
  it("reads a network from its key, CAIP-2 id or chain id", () => {
    expect(payNetworkOf("robinhood")).toBe("robinhood");
    expect(payNetworkOf("eip155:4663")).toBe("robinhood");
    expect(payNetworkOf("42161")).toBe("arbitrum");
    expect(payNetworkOf(PAY_NETWORKS.solana.caip)).toBe("solana");
    expect(payNetworkOf("ethereum")).toBeNull();
  });

  it("lists only networks it knows", () => {
    for (const k of PAY_KEYS) expect(isPayKey(k)).toBe(true);
    expect(isPayKey("ethereum")).toBe(false);
  });
});
