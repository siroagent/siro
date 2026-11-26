import { describe, expect, it } from "vitest";
import { CHAIN_KEYS, X402Error, choose, readQuote } from "../shared/x402client";
import { pickRequirements, requirements, termsMatch, CHAINS, type PaymentPayload } from "../worker/x402";

const TREASURY = "0x1111111111111111111111111111111111111111";
const env = { TREASURY, SOLANA_TREASURY: "" } as unknown as Env;
const robinhood = CHAINS.find((c) => c.network === "eip155:4663")!;
const base = CHAINS.find((c) => c.network === "eip155:8453")!;

const evmPayment = (value: string, to = TREASURY, network = "eip155:4663"): PaymentPayload => ({
  x402Version: 2,
  accepted: { network },
  payload: {
    signature: "0x00",
    authorization: { from: "0x2222222222222222222222222222222222222222", to, value, validAfter: "0", validBefore: "9999999999", nonce: "0x01" },
  },
});

describe("requirements", () => {
  it("quotes the exact amount to the treasury with the token's EIP-712 domain", () => {
    const r = requirements(env, 20000n, robinhood);
    expect(r).toMatchObject({ scheme: "exact", network: "eip155:4663", amount: "20000", payTo: TREASURY, maxTimeoutSeconds: 120 });
    expect(r.extra).toHaveProperty("name");
  });
});

describe("termsMatch", () => {
  const req = requirements(env, 20000n, robinhood);

  it("accepts a payment for exactly the quoted amount to the treasury", () => {
    expect(termsMatch(evmPayment("20000"), req)).toBeNull();
  });

  it("refuses a smaller amount, even by one base unit", () => {
    expect(termsMatch(evmPayment("19999"), req)).toMatch(/does not match/);
  });

  it("refuses a payment to another address", () => {
    expect(termsMatch(evmPayment("20000", "0x3333333333333333333333333333333333333333"), req)).toMatch(/recipient/);
  });

  it("refuses a Solana payload for an EVM quote", () => {
    const p: PaymentPayload = { x402Version: 2, accepted: { network: "eip155:4663" }, payload: { transaction: "AAAA" } };
    expect(termsMatch(p, req)).toMatch(/does not fit/);
  });
});

describe("pickRequirements", () => {
  const reqs = [requirements(env, 20000n, robinhood), requirements(env, 20000n, base)];

  it("picks the network the client signed for", () => {
    const r = pickRequirements(evmPayment("20000", TREASURY, "eip155:8453"), reqs);
    expect(typeof r).toBe("object");
    expect((r as { network: string }).network).toBe("eip155:8453");
  });

  it("explains which networks are accepted when the client names another", () => {
    expect(pickRequirements(evmPayment("20000", TREASURY, "eip155:1"), reqs)).toMatch(/not accepted/);
  });
});

describe("readQuote and choose", () => {
  const quote = (accepts: unknown[], extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ x402Version: 2, accepts, ...extra }), { status: 402, headers: { "content-type": "application/json" } });

  it("keeps only payable stablecoin quotes and prefers the first preferred chain", async () => {
    const q = await readQuote(
      quote([
        { scheme: "exact", network: "eip155:8453", amount: "1000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: TREASURY, extra: { name: "USD Coin", version: "2" } },
        { scheme: "exact", network: "eip155:4663", amount: "1000", asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", payTo: TREASURY },
        { scheme: "exact", network: "eip155:8453", amount: "1000", asset: "0x0000000000000000000000000000000000000bad", payTo: TREASURY },
      ]),
    );
    expect(q.accepts).toHaveLength(2);
    expect(choose(q, ["robinhood", "base"]).chain.key).toBe("robinhood");
    expect(choose(q, ["base"]).usd).toBe(0.001);
  });

  it("reads the quote from the PAYMENT-REQUIRED header when present", async () => {
    const body = { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:4663", amount: "750", asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", payTo: TREASURY }] };
    const res = new Response("{}", { status: 402, headers: { "payment-required": btoa(JSON.stringify(body)) } });
    expect((await readQuote(res)).accepts[0].amount).toBe("750");
  });

  it("passes an input error through, so a client never signs for a bad request", async () => {
    const q = await readQuote(quote([], { inputError: { code: "missing_field", message: "prompt is required" } }));
    expect(q.inputError).toEqual({ code: "missing_field", message: "prompt is required" });
  });

  it("refuses a 402 that is not x402", async () => {
    await expect(readQuote(new Response("Payment Required", { status: 402 }))).rejects.toBeInstanceOf(X402Error);
  });

  it("explains what the service accepts when nothing is payable", async () => {
    const q = await readQuote(quote([{ scheme: "exact", network: "eip155:1", amount: "1", asset: "0x0", payTo: TREASURY }]));
    expect(() => choose(q, CHAIN_KEYS)).toThrow(/only accepts exact\/eip155:1/);
  });
});
