import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { Siro, SiroError, type SpendEntry } from "../cli/src/core";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const TREASURY = "0x1111111111111111111111111111111111111111";

/** A 402 quote for `units` base units of USDG on Robinhood Chain. */
const quote = (units: number) =>
  new Response(
    JSON.stringify({
      x402Version: 2,
      resource: { url: "https://siroagent.com/v1/gas-now" },
      accepts: [{ scheme: "exact", network: "eip155:4663", amount: String(units), asset: USDG, payTo: TREASURY, maxTimeoutSeconds: 120, extra: { name: "Global Dollar", version: "1" } }],
    }),
    { status: 402, headers: { "content-type": "application/json" } },
  );
const paid = (units: number, payer: string) =>
  new Response(JSON.stringify({ resource: "gas-now", result: { ok: true }, receipt: { network: "eip155:4663", asset: "USDG", amountUsd: units / 1e6, payer, tx: "0xabc", ms: 5 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const noTier = () => new Response(JSON.stringify({ siro: 0, tier: null, freeLeftToday: 0, freeTools: [] }), { status: 200 });

type Call = { url: string; headers: Headers };
function mockFetch(handler: (url: string, init: RequestInit | undefined, calls: Call[]) => Response) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    return handler(url, init, calls);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const wallet = (entries: SpendEntry[] = [], limits = {}) =>
  new Siro({ privateKey: generatePrivateKey(), limits, ledger: { entries: () => entries, record: (e) => void entries.push(e) } });

afterEach(() => vi.unstubAllGlobals());

describe("caps", () => {
  it("refuses a quote above the per-payment cap before signing anything", async () => {
    const calls = mockFetch((url) => (url.includes("/api/holder/") ? noTier() : quote(200_000)));
    const err = await wallet([], { perPayment: 0.1 }).call("claude-haiku-4-5", { prompt: "hi" }).catch((e) => e);
    expect(err).toBeInstanceOf(SiroError);
    expect(err.code).toBe("over_payment_cap");
    expect(calls.filter((c) => c.url.includes("/v1/")).every((c) => !c.headers.has("payment-signature"))).toBe(true);
  });

  it("counts only this wallet's spend made today towards the daily cap", () => {
    const entries: SpendEntry[] = [];
    const s = wallet(entries);
    entries.push({ at: Date.now(), kind: "resource", what: "a", usd: 0.4, network: "robinhood", tx: "0x1", payer: s.address });
    entries.push({ at: Date.now(), kind: "resource", what: "b", usd: 0.3, network: "robinhood", tx: "0x2", payer: "0x2222222222222222222222222222222222222222" });
    entries.push({ at: Date.now() - 3 * 86_400_000, kind: "resource", what: "c", usd: 0.5, network: "robinhood", tx: "0x3", payer: s.address });
    entries.push({ at: Date.now(), kind: "swap", what: "swap", usd: 9, network: "robinhood", tx: "0x4", payer: s.address });
    expect(s.spentToday()).toBeCloseTo(0.4, 9);
  });

  it("refuses when this wallet's spend today plus the quote passes the daily cap", async () => {
    mockFetch(() => quote(50_000));
    const entries: SpendEntry[] = [];
    const s = wallet(entries, { perDay: 1 });
    entries.push({ at: Date.now(), kind: "resource", what: "a", usd: 0.98, network: "robinhood", tx: "0x1", payer: s.address });
    const err = await s.call("claude-haiku-4-5", { prompt: "hi" }).catch((e) => e);
    expect(err.code).toBe("over_daily_cap");
  });
});

describe("paying", () => {
  it("signs exactly the quoted amount, names the payer for holder pricing and records the spend", async () => {
    const entries: SpendEntry[] = [];
    const s = wallet(entries);
    const calls = mockFetch((url, _init, all) => {
      if (url.includes("/api/holder/")) return noTier();
      return all.filter((c) => c.url.includes("/v1/")).length === 1 ? quote(1000) : paid(1000, s.address);
    });
    const out = await s.call("claude-haiku-4-5", { prompt: "hi" });
    expect(out.receipt?.amountUsd).toBe(0.001);
    const v1 = calls.filter((c) => c.url.includes("/v1/claude-haiku-4-5"));
    expect(v1).toHaveLength(2);
    expect(v1[0].headers.get("x-siro-holder")).toBe(s.address);
    const sig = v1[1].headers.get("payment-signature");
    expect(sig).toBeTruthy();
    const payload = JSON.parse(atob(sig!));
    expect(payload.payload.authorization.value).toBe("1000");
    expect(payload.payload.authorization.to.toLowerCase()).toBe(TREASURY);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "resource", what: "claude-haiku-4-5", usd: 0.001, network: "robinhood" });
  });

  it("lets the approve hook decline before signing", async () => {
    const calls = mockFetch(() => quote(1000));
    const s = new Siro({ privateKey: generatePrivateKey(), approve: () => false });
    const err = await s.call("claude-haiku-4-5", { prompt: "hi" }).catch((e) => e);
    expect(err.code).toBe("declined");
    expect(calls.some((c) => c.headers.has("payment-signature"))).toBe(false);
  });
});

describe("free holder runs", () => {
  it("runs a data tool free with a signed holder pass while the allowance lasts", async () => {
    const calls = mockFetch((url, init) => {
      if (url.includes("/api/holder/")) return new Response(JSON.stringify({ siro: 2_000_000, tier: { name: "Holder 1M", discountPct: 25, freePerDay: 10 }, freeLeftToday: 3, freeTools: ["gas-now"] }), { status: 200 });
      if (new Headers(init?.headers).has("x-siro-pass")) return new Response(JSON.stringify({ resource: "gas-now", result: { block: 1 }, receipt: null, free: { holder: "x", tier: "Holder 1M", leftToday: 2 } }), { status: 200 });
      return quote(1000);
    });
    const out = await wallet().call("gas-now", {});
    expect(out.free?.leftToday).toBe(2);
    expect(calls.some((c) => c.headers.has("payment-signature"))).toBe(false);
    expect(calls.find((c) => c.headers.has("x-siro-pass"))?.headers.get("x-siro-pass")).toMatch(/^0x[0-9a-f]{40}\.\d+\.0x[0-9a-f]+$/);
  });

  it("pays as usual when asked to, even with an allowance left", async () => {
    const calls = mockFetch((url) => (url.includes("/api/holder/") ? noTier() : quote(1000)));
    await wallet([], {}).call("gas-now", {}, { free: false }).catch(() => null);
    expect(calls.some((c) => c.url.includes("/api/holder/"))).toBe(false);
    expect(calls.some((c) => c.headers.has("x-siro-pass"))).toBe(false);
  });
});
