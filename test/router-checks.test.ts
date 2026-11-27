import { beforeEach, describe, expect, it, vi } from "vitest";
import { RETRIES, checkAnswer, pickModel, readCheck, retryLadder } from "../shared/router";
import { toUnits } from "../shared/catalog";

// Anthropic models all run through runPremium, so the router's model calls can be scripted here.
const answers: Record<string, string> = {};
const calls: string[] = [];
vi.mock("../worker/premium", () => ({
  premiumReady: () => true,
  SLOW_PAYMENT_SECONDS: 600,
  runPremium: async (_env: unknown, r: { id: string; name: string }) => {
    calls.push(r.id);
    return { text: answers[r.id] ?? "", model: r.name };
  },
}));
const { execute } = await import("../worker/run");
const { Fail } = await import("../worker/fail");
const { ROUTER } = await import("../shared/catalog");

/** A D1 stand-in for the retry budget: counts what was booked and refuses past `cap` units. */
function fakeEnv(cap = Infinity) {
  let booked = 0;
  return {
    booked: () => booked,
    env: {
      DB: {
        prepare: () => ({
          bind: (_day: string, units: number) => ({
            first: async () => {
              if (booked + units > cap) return null;
              booked += units;
              return { units: booked };
            },
          }),
        }),
      },
    } as unknown as Env,
  };
}

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
});

describe("readCheck", () => {
  it("is null when the input sets no check", () => {
    expect(readCheck({ prompt: "hi" })).toBeNull();
  });

  it("reads phrases, length and JSON keys; json_keys implies json", () => {
    expect(readCheck({ must_include: "risk, price ,", min_chars: 50, json_keys: "a,b" })).toEqual({ mustInclude: ["risk", "price"], minChars: 50, json: true, jsonKeys: ["a", "b"] });
  });

  it("refuses a bad min_chars and too many phrases", () => {
    expect(() => readCheck({ min_chars: 0 })).toThrow(/min_chars/);
    expect(() => readCheck({ must_include: Array.from({ length: 11 }, (_, i) => `w${i}`).join(",") })).toThrow(/Up to 10/);
  });
});

describe("checkAnswer", () => {
  const c = (o: Partial<{ mustInclude: string[]; minChars: number | null; json: boolean; jsonKeys: string[] }>) => ({ mustInclude: [], minChars: null, json: false, jsonKeys: [], ...o });

  it("passes when every check holds", () => {
    expect(checkAnswer("The price and the RISK are clear.", c({ mustInclude: ["risk", "price"], minChars: 10 }))).toBeNull();
  });

  it("names the missing phrases, case-insensitively", () => {
    expect(checkAnswer("only price here", c({ mustInclude: ["Risk", "price"] }))).toBe('missing "Risk"');
  });

  it("checks the length after trimming", () => {
    expect(checkAnswer("   short   ", c({ minChars: 10 }))).toMatch(/shorter than 10/);
  });

  it("accepts JSON with or without a code fence and checks top-level keys", () => {
    expect(checkAnswer('```json\n{"title":"x","summary":"y"}\n```', c({ json: true, jsonKeys: ["title", "summary"] }))).toBeNull();
    expect(checkAnswer('{"title":"x"}', c({ json: true, jsonKeys: ["title", "summary"] }))).toBe("JSON lacks summary");
    expect(checkAnswer("Sure! Here it is: {", c({ json: true }))).toBe("not valid JSON");
    expect(checkAnswer("42", c({ json: true }))).toMatch(/not an object/);
  });
});

describe("retryLadder", () => {
  it("starts at the pick and climbs the same tier and maker, never down, at most RETRIES more", () => {
    const p = pickModel({ tier: "fast" });
    const ladder = retryLadder(p);
    expect(ladder[0].id).toBe(p.resource.id);
    expect(ladder.length).toBeLessThanOrEqual(1 + RETRIES);
    for (let i = 1; i < ladder.length; i++) expect(toUnits(ladder[i].price) >= toUnits(ladder[i - 1].price)).toBe(true);
  });

  it("can retry above max_price, since retries are Siro's", () => {
    const p = pickModel({ tier: "fast", maker: "anthropic", max_price: "0.02" });
    expect(p.resource.id).toBe("claude-haiku-4-5");
    expect(retryLadder(p)).toHaveLength(1);
    const q = pickModel({ tier: "frontier", maker: "anthropic" });
    expect(retryLadder(q).map((r) => r.id)).toEqual(["claude-opus-5-5"]);
  });
});

describe("router with a check", () => {
  // frontier, any maker: GPT-5.6 Sol $0.04, Gemini 3.1 Pro $0.045, Claude Opus 5.5 $0.08, all run through runPremium.
  const input = { prompt: "Summarise", tier: "frontier", must_include: "risk" };

  it("returns the first answer that passes, and the caller pays only the quoted model", async () => {
    answers["gpt-5-6-sol"] = "The risk is small.";
    const { env, booked } = fakeEnv();
    const out = (await execute(env, ROUTER, input)) as any;
    expect(out.text).toBe("The risk is small.");
    expect(out.picked.model).toBe("gpt-5-6-sol");
    expect(out.check).toEqual({ passed: true, attempts: [{ model: "gpt-5-6-sol", name: "GPT-5.6 Sol", priceUsd: 0.04, paidBy: "you", passed: true }] });
    expect(booked()).toBe(0);
  });

  it("retries the next model at Siro's cost when the answer fails", async () => {
    answers["gpt-5-6-sol"] = "Looks fine.";
    answers["gemini-3-1-pro"] = "One risk stands out.";
    const { env, booked } = fakeEnv();
    const out = (await execute(env, ROUTER, input)) as any;
    expect(out.text).toBe("One risk stands out.");
    expect(out.picked.model).toBe("gpt-5-6-sol");
    expect(out.check.attempts.map((a: any) => [a.model, a.paidBy, a.passed])).toEqual([
      ["gpt-5-6-sol", "you", false],
      ["gemini-3-1-pro", "siro", true],
    ]);
    expect(out.check.attempts[0].reason).toBe('missing "risk"');
    expect(booked()).toBe(45_000);
  });

  it("charges nothing when no answer passes", async () => {
    const { env, booked } = fakeEnv();
    const err = (await execute(env, ROUTER, input).catch((e) => e)) as any;
    expect(err).toBeInstanceOf(Fail);
    expect(err.status).toBe(422);
    expect(err.code).toBe("no_answer_passed");
    expect(err.message).toMatch(/You were not charged/);
    expect(calls).toEqual(["gpt-5-6-sol", "gemini-3-1-pro", "claude-opus-5-5"]);
    expect(booked()).toBe(45_000 + 80_000);
  });

  it("stops retrying once the day's retry budget is spent", async () => {
    answers["gpt-5-6-sol"] = "no";
    const { env, booked } = fakeEnv(0);
    const err = (await execute(env, ROUTER, input).catch((e) => e)) as any;
    expect(err.code).toBe("no_answer_passed");
    expect(err.message).toMatch(/retry budget/);
    expect(calls).toEqual(["gpt-5-6-sol"]);
    expect(booked()).toBe(0);
  });

  it("asks for JSON in the system prompt when the check wants JSON", async () => {
    answers["gpt-5-6-sol"] = '{"title":"a","summary":"b"}';
    const { env } = fakeEnv();
    const out = (await execute(env, ROUTER, { prompt: "x", tier: "frontier", json_keys: "title,summary" })) as any;
    expect(out.check.passed).toBe(true);
  });
});
