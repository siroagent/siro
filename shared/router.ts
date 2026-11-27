// "Cheapest model": the agent names a tier and, if it likes, a maker and a price ceiling; Siro picks the
// cheapest language model in the catalog that fits, and the 402 quote names that model and its price before
// anything is signed. The pick is deterministic: the same input gives the same model, at quote time and at run time.
import { RESOURCES, toUnits, type Resource } from "./catalog";

export const TIERS = ["fast", "balanced", "frontier"] as const;
export type Tier = (typeof TIERS)[number];
export const MAKERS = ["any", "anthropic", "openai", "google", "deepseek", "meta", "moonshot", "zai", "alibaba", "nvidia", "open-weight"] as const;
export type Maker = (typeof MAKERS)[number];

/** Siro's grouping of its language models, from how each maker positions the model (small and quick, strong
 *  general reasoning, or the maker's top model). Every LLM in the catalog has an entry; a test checks it. */
export const MODEL_INFO: Record<string, { tier: Tier; maker: Exclude<Maker, "any" | "open-weight">; openWeight: boolean }> = {
  "gemma-4": { tier: "fast", maker: "google", openWeight: true },
  "llama-4-scout": { tier: "fast", maker: "meta", openWeight: true },
  "gpt-oss-120b": { tier: "fast", maker: "openai", openWeight: true },
  "deepseek-v4-1-flash": { tier: "fast", maker: "deepseek", openWeight: true },
  "nemotron-3": { tier: "fast", maker: "nvidia", openWeight: true },
  "qwen-3-8": { tier: "fast", maker: "alibaba", openWeight: true },
  "claude-haiku-4-5": { tier: "fast", maker: "anthropic", openWeight: false },
  "gpt-5-6-luna": { tier: "fast", maker: "openai", openWeight: false },
  "gemini-3-5-flash": { tier: "fast", maker: "google", openWeight: false },
  "kimi-k2-6": { tier: "balanced", maker: "moonshot", openWeight: true },
  "deepseek-v4-pro": { tier: "balanced", maker: "deepseek", openWeight: true },
  "glm-5-3": { tier: "balanced", maker: "zai", openWeight: true },
  "claude-sonnet-5": { tier: "balanced", maker: "anthropic", openWeight: false },
  "gpt-5-6-terra": { tier: "balanced", maker: "openai", openWeight: false },
  "claude-opus-5-5": { tier: "frontier", maker: "anthropic", openWeight: false },
  "gpt-5-6-sol": { tier: "frontier", maker: "openai", openWeight: false },
  "gemini-3-1-pro": { tier: "frontier", maker: "google", openWeight: false },
};

export class PickError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type Pick = {
  resource: Resource;
  tier: Tier;
  maker: Maker;
  /** The models that fitted, cheapest first, so the receipt can show what the pick saved. */
  candidates: { id: string; name: string; price: string }[];
};

const units = (r: Resource) => toUnits(r.price);

/** The cheapest catalog model for this input. `ready` drops models that are not switched on right now. */
export function pickModel(input: Record<string, unknown>, ready: (r: Resource) => boolean = () => true): Pick {
  const tier = (input.tier ?? "fast") as Tier;
  const maker = (input.maker ?? "any") as Maker;
  if (!TIERS.includes(tier)) throw new PickError("invalid_field", `tier must be one of ${TIERS.join(", ")}`);
  if (!MAKERS.includes(maker)) throw new PickError("invalid_field", `maker must be one of ${MAKERS.join(", ")}`);
  let ceiling: bigint | null = null;
  if (input.max_price !== undefined) {
    const s = String(input.max_price).trim();
    if (!/^\d+(\.\d{1,6})?$/.test(s) || toUnits(s) <= 0n) throw new PickError("invalid_field", "max_price must be a USD amount such as 0.03");
    ceiling = toUnits(s);
  }
  const fits = RESOURCES.filter((r) => {
    const m = MODEL_INFO[r.id];
    if (!m || r.category !== "llm" || m.tier !== tier) return false;
    if (maker === "open-weight" ? !m.openWeight : maker !== "any" && m.maker !== maker) return false;
    return ready(r);
  }).sort((a, b) => (units(a) === units(b) ? a.id.localeCompare(b.id) : units(a) < units(b) ? -1 : 1));
  const affordable = ceiling === null ? fits : fits.filter((r) => units(r) <= ceiling!);
  if (!affordable.length) {
    const cheapest = fits[0];
    throw new PickError(
      "no_model_fits",
      cheapest ? `The cheapest ${tier} model${maker === "any" ? "" : ` from ${maker}`} is ${cheapest.name} at $${cheapest.price}, above max_price.` : `No ${tier} model${maker === "any" ? "" : ` from ${maker}`} is available right now.`,
    );
  }
  return { resource: affordable[0], tier, maker, candidates: affordable.map((r) => ({ id: r.id, name: r.name, price: r.price })) };
}

/** What the result and the receipt say about the pick. */
export function pickSummary(p: Pick) {
  const top = p.candidates[p.candidates.length - 1];
  return {
    model: p.resource.id,
    name: p.resource.name,
    priceUsd: Number(p.resource.price),
    tier: p.tier,
    maker: p.maker,
    consideredModels: p.candidates.length,
    mostExpensiveFit: top && top.id !== p.resource.id ? { model: top.id, name: top.name, priceUsd: Number(top.price) } : null,
  };
}
