import { describe, expect, it } from "vitest";
import { RESOURCES, ROUTER, byId, toUnits } from "../shared/catalog";
import { MAKERS, MODEL_INFO, PickError, TIERS, pickModel, pickSummary } from "../shared/router";
import { prepare } from "../worker/run";

const llms = RESOURCES.filter((r) => r.category === "llm");
const cheapest = (ids: string[]) => ids.map((id) => byId(id)!).sort((a, b) => Number(toUnits(a.price) - toUnits(b.price)) || a.id.localeCompare(b.id))[0].id;

describe("model table", () => {
  it("covers every language model in the catalog, and nothing else", () => {
    expect(Object.keys(MODEL_INFO).sort()).toEqual(llms.map((r) => r.id).sort());
  });

  it("matches the options the router resource offers", () => {
    expect(ROUTER.fields.find((f) => f.name === "tier")?.options).toEqual([...TIERS]);
    expect(ROUTER.fields.find((f) => f.name === "maker")?.options).toEqual([...MAKERS]);
  });

  it("is not counted as a tool", () => {
    expect(RESOURCES.some((r) => r.id === ROUTER.id)).toBe(false);
    expect(byId(ROUTER.id)).toBe(ROUTER);
  });

  it("asks for a prompt no longer than every model it can pick accepts", () => {
    const max = ROUTER.fields.find((f) => f.name === "prompt")!.max!;
    for (const r of llms) expect(r.fields.find((f) => f.name === "prompt")!.max!, r.id).toBeGreaterThanOrEqual(max);
  });
});

describe("pickModel", () => {
  it("picks the cheapest model of each tier", () => {
    for (const tier of TIERS) {
      const ids = Object.entries(MODEL_INFO).filter(([, m]) => m.tier === tier).map(([id]) => id);
      expect(pickModel({ tier }).resource.id, tier).toBe(cheapest(ids));
    }
  });

  it("defaults to the fast tier and any maker", () => {
    const p = pickModel({});
    expect(p.tier).toBe("fast");
    expect(p.maker).toBe("any");
  });

  it("keeps to one maker when asked", () => {
    const p = pickModel({ tier: "fast", maker: "anthropic" });
    expect(p.resource.id).toBe("claude-haiku-4-5");
    expect(p.candidates.every((c) => MODEL_INFO[c.id].maker === "anthropic")).toBe(true);
  });

  it("picks only open-weight models when asked", () => {
    const p = pickModel({ tier: "balanced", maker: "open-weight" });
    expect(p.candidates.every((c) => MODEL_INFO[c.id].openWeight)).toBe(true);
  });

  it("never goes above max_price, and says why when nothing fits", () => {
    const p = pickModel({ tier: "frontier", max_price: "0.045" });
    expect(Number(p.resource.price)).toBeLessThanOrEqual(0.045);
    expect(p.candidates.every((c) => Number(c.price) <= 0.045)).toBe(true);
    expect(() => pickModel({ tier: "frontier", max_price: "0.01" })).toThrow(PickError);
    expect(() => pickModel({ tier: "frontier", max_price: "0.01" })).toThrow(/above max_price/);
  });

  it("refuses a malformed max_price", () => {
    for (const bad of ["abc", "-1", "0", "0.0000001"]) expect(() => pickModel({ max_price: bad }), bad).toThrow(PickError);
  });

  it("skips models that are switched off", () => {
    const off = pickModel({ tier: "fast" }).resource.id;
    expect(pickModel({ tier: "fast" }, (r) => r.id !== off).resource.id).not.toBe(off);
    expect(() => pickModel({ tier: "frontier" }, () => false)).toThrow(/No frontier model/);
  });

  it("is deterministic, so the quote and the run pick the same model", () => {
    const input = { tier: "balanced", maker: "any", max_price: "0.05" };
    expect(pickModel(input).resource.id).toBe(pickModel({ ...input }).resource.id);
  });
});

describe("pickSummary", () => {
  it("names the pick and the most expensive model that also fitted", () => {
    const s = pickSummary(pickModel({ tier: "frontier" }));
    expect(s.tier).toBe("frontier");
    expect(s.consideredModels).toBe(3);
    expect(s.mostExpensiveFit?.priceUsd).toBeGreaterThan(s.priceUsd);
  });

  it("has nothing to compare when only one model fits", () => {
    expect(pickSummary(pickModel({ tier: "frontier", maker: "google" })).mostExpensiveFit).toBeNull();
  });
});

describe("router input", () => {
  it("is checked like any resource before a payment", () => {
    expect(prepare(ROUTER, { prompt: "hi", tier: "balanced", maker: "openai", max_price: "0.06" })).toEqual({ prompt: "hi", tier: "balanced", maker: "openai", max_price: "0.06" });
    expect(() => prepare(ROUTER, { prompt: "hi", tier: "huge" })).toThrow(/tier must be one of/);
  });
});
