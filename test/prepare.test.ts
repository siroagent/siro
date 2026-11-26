import { describe, expect, it } from "vitest";
import { byId, type Resource } from "../shared/catalog";
import { prepare } from "../worker/run";
import { Fail } from "../worker/fail";

const tool = (id: string) => byId(id) as Resource;
const failOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as Fail;
  }
  throw new Error("expected a Fail");
};

describe("prepare", () => {
  it("refuses a body that is not a JSON object", () => {
    expect(failOf(() => prepare(tool("gas-now"), [1, 2])).code).toBe("invalid_body");
    expect(failOf(() => prepare(tool("gas-now"), "text")).code).toBe("invalid_body");
  });

  it("asks for a required field before anything is charged", () => {
    const f = failOf(() => prepare(tool("claude-haiku-4-5"), {}));
    expect(f.status).toBe(400);
    expect(f.code).toBe("missing_field");
  });

  it("drops fields the catalog does not list", () => {
    expect(prepare(tool("claude-haiku-4-5"), { prompt: "hi", injected: "x" })).not.toHaveProperty("injected");
  });

  it("reads the network field by name or chain id", () => {
    expect(prepare(tool("gas-now"), { network: "base" })).toEqual({ network: "base" });
    expect(prepare(tool("gas-now"), { network: "4663" })).toEqual({ network: "robinhood" });
    expect(failOf(() => prepare(tool("gas-now"), { network: "ethereum" })).code).toBe("invalid_network");
  });

  it("refuses links to private addresses and plain http", () => {
    const r = tool("web-read");
    const urlField = r.fields.find((f) => f.type === "url")!.name;
    expect(failOf(() => prepare(r, { [urlField]: "http://example.com" })).code).toBe("invalid_url");
    expect(failOf(() => prepare(r, { [urlField]: "https://127.0.0.1/admin" })).code).toBe("invalid_url");
    expect(failOf(() => prepare(r, { [urlField]: "https://metadata.internal/" })).code).toBe("invalid_url");
    expect(prepare(r, { [urlField]: "https://example.com/page" })[urlField]).toBe("https://example.com/page");
  });

  it("caps numbers at the field maximum", () => {
    const r = tool("claude-haiku-4-5");
    const max = r.fields.find((f) => f.name === "max_tokens")!.max!;
    expect(prepare(r, { prompt: "hi", max_tokens: max * 10 }).max_tokens).toBe(max);
    expect(failOf(() => prepare(r, { prompt: "hi", max_tokens: -1 })).code).toBe("invalid_field");
  });
});
