import { describe, expect, it } from "vitest";
import { RESOURCES, ROUTER } from "../shared/catalog";
import { openapi } from "../worker/openapi";

const doc = openapi({} as Env, "1.0.0") as any;

describe("/openapi.json", () => {
  it("has the fields x402scan requires", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Siro");
    expect(doc.info["x-guidance"].length).toBeGreaterThan(50);
  });

  it("prices every listed tool as the quote does, and keeps the router dynamic", () => {
    const paths = Object.keys(doc.paths);
    expect(paths).toContain(`/v1/${ROUTER.id}`);
    for (const p of paths) {
      const op = doc.paths[p].post;
      expect(op.responses["402"]).toBeTruthy();
      expect(op["x-payment-info"].protocols).toEqual([{ x402: {} }]);
      expect(op.requestBody.content["application/json"].schema.type).toBe("object");
      const r = RESOURCES.find((x) => `/v1/${x.id}` === p);
      if (r) expect(Number(op["x-payment-info"].price.amount)).toBe(Number(r.price));
    }
    const router = doc.paths[`/v1/${ROUTER.id}`].post["x-payment-info"].price;
    expect(router.mode).toBe("dynamic");
    expect(Number(router.min)).toBeLessThan(Number(router.max));
  });

  it("gives every operation a unique id", () => {
    const ids = Object.values(doc.paths).map((p: any) => p.post.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
