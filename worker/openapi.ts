// /openapi.json: the catalog as an OpenAPI 3.1 document, the discovery contract x402scan and other
// directories read. Built from the same catalog as the 402 quotes, so a price here is the price quoted.
import { RESOURCES, ROUTER, toUnits, type Resource } from "../shared/catalog";
import { fieldSchema, exampleBody } from "./bazaar";
import { premiumReady } from "./premium";

const SITE = "https://siroagent.com";

const GUIDANCE =
  "Every tool is POST /v1/<id> with a JSON body. Without a payment the answer is a 402 quote (x402 v2, PAYMENT-REQUIRED header) " +
  "in USDG on Robinhood Chain or USDC on Base, Solana, Arbitrum or Polygon; sign it and send it back in PAYMENT-SIGNATURE. " +
  "Input is checked before the payment is verified, and the payment settles only when the result is ready, so a failed call is never charged. " +
  "For text, POST /v1/llm-auto picks the cheapest language model that fits a tier and names it in the quote. " +
  "GET /v1/resources lists every tool with its price; the receipt in each result carries the transaction hash.";

const usd = (units: bigint) => (Number(units) / 1e6).toFixed(6);

function price(r: Resource) {
  if (r.id !== ROUTER.id) return { mode: "fixed", currency: "USD", amount: usd(toUnits(r.price)) };
  // The router quotes the model it picks, so its price runs from the cheapest language model to the dearest.
  const llm = RESOURCES.filter((x) => x.category === "llm").map((x) => toUnits(x.price));
  const min = llm.reduce((a, b) => (b < a ? b : a));
  const max = llm.reduce((a, b) => (b > a ? b : a));
  return { mode: "dynamic", currency: "USD", min: usd(min), max: usd(max) };
}

function operation(r: Resource) {
  const body = {
    type: "object",
    properties: Object.fromEntries(r.fields.map((f) => [f.name, fieldSchema(f)])),
    required: r.fields.filter((f) => f.required).map((f) => f.name),
    additionalProperties: false,
  };
  return {
    post: {
      operationId: r.id.replace(/[^a-zA-Z0-9]+(.)?/g, (_, ch: string | undefined) => (ch ?? "").toUpperCase()),
      summary: `${r.name} - ${r.summary}`.slice(0, 300),
      tags: [r.category],
      "x-payment-info": { price: price(r), protocols: [{ x402: {} }] },
      requestBody: { required: true, content: { "application/json": { schema: body, example: exampleBody(r) } } },
      responses: {
        "200": {
          description: `Result and receipt. Result: ${r.returns}`.slice(0, 500),
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  resource: { type: "string" },
                  result: {},
                  receipt: {
                    type: "object",
                    properties: {
                      network: { type: "string" },
                      asset: { type: "string" },
                      amountUsd: { type: "number" },
                      payer: { type: "string" },
                      tx: { type: "string" },
                      resultSha256: { type: "string" },
                    },
                  },
                },
                required: ["resource", "result", "receipt"],
              },
            },
          },
        },
        "400": { description: "Input rejected before any payment." },
        "402": { description: "Payment Required" },
      },
    },
  };
}

export function openapi(env: Env, version: string) {
  const live = [...RESOURCES.filter((r) => premiumReady(env, r)), ROUTER];
  return {
    openapi: "3.1.0",
    info: {
      title: "Siro",
      version,
      description: "Pay-per-call AI, media, on-chain data, tokenized stocks and prediction markets for agents over x402.",
      "x-guidance": GUIDANCE,
    },
    servers: [{ url: SITE }],
    externalDocs: { url: `${SITE}/docs` },
    paths: Object.fromEntries(live.map((r) => [`/v1/${r.id}`, operation(r)])),
  };
}
