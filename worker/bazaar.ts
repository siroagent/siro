// x402 Bazaar discovery metadata (the `bazaar` extension), built from the catalog so every
// resource describes its JSON body with an example and a JSON Schema. Same shape as
// declareDiscoveryExtension({ method: "POST", bodyType: "json", ... }) in @x402/extensions.
import type { Field, Resource } from "../shared/catalog";

export function fieldSchema(f: Field): Record<string, unknown> {
  const base = { description: f.description };
  switch (f.type) {
    case "number":
      return { ...base, type: "number", exclusiveMinimum: 0, ...(f.max ? { maximum: f.max } : {}) };
    case "enum":
    case "network":
      return { ...base, type: "string", enum: f.options ?? ["robinhood", "base"] };
    case "address":
      return { ...base, type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
    case "url":
      return { ...base, type: "string", format: "uri", pattern: "^https://" };
    default:
      return { ...base, type: "string", minLength: 1, ...(f.max ? { maxLength: f.max } : {}) };
  }
}

/** A body that passes our own validation: every field that has an example. */
export function exampleBody(r: Resource): Record<string, unknown> {
  return Object.fromEntries(r.fields.filter((f) => f.example !== undefined).map((f) => [f.name, f.example]));
}

export function bazaarExtension(r: Resource) {
  const body = {
    type: "object",
    properties: Object.fromEntries(r.fields.map((f) => [f.name, fieldSchema(f)])),
    required: r.fields.filter((f) => f.required).map((f) => f.name),
    additionalProperties: false,
  };
  const outputExample = {
    resource: r.id,
    result: `${r.returns}`,
    receipt: { network: "eip155:8453", asset: "USDC", amountUsd: Number(r.price), payer: "0x…", tx: "0x…", ms: 1200, resultSha256: "…" },
  };
  return {
    info: {
      input: { type: "http", method: "POST", bodyType: "json", body: exampleBody(r) },
      output: { type: "json", example: outputExample },
    },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        input: {
          type: "object",
          properties: {
            type: { type: "string", const: "http" },
            method: { type: "string", enum: ["POST", "PUT", "PATCH"] },
            bodyType: { type: "string", enum: ["json", "form-data", "text"] },
            body,
          },
          required: ["type", "method", "bodyType", "body"],
          additionalProperties: false,
        },
        output: { type: "object", properties: { type: { type: "string" }, example: { type: "object" } }, required: ["type"] },
      },
      required: ["input"],
    },
    category: r.category,
  };
}
