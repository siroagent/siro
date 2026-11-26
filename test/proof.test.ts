import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PROOF_PAYERS, mediaKeyOf, resultReceipt } from "../worker/proof";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("resultReceipt", () => {
  it("hashes JSON.stringify(result), the exact text a payer can recompute", async () => {
    const result = { network: "robinhood", block: 123686815, gasPriceGwei: 0.020068 };
    const rr = await resultReceipt(result);
    expect(rr.sha).toBe(sha(JSON.stringify(result)));
    expect(rr.bytes).toBe(Buffer.byteLength(JSON.stringify(result)));
    expect(rr.kind).toBe("data");
  });

  it("counts bytes, not characters, for non-ASCII text", async () => {
    const rr = await resultReceipt({ text: "café ☕" });
    expect(rr.bytes).toBe(Buffer.byteLength(JSON.stringify({ text: "café ☕" })));
    expect(rr.kind).toBe("text");
  });

  it("names the kind of media a result carries", async () => {
    expect((await resultReceipt({ image: "https://siroagent.com/media/a.jpg" })).kind).toBe("image");
    expect((await resultReceipt({ video: "https://siroagent.com/media/a.mp4" })).kind).toBe("video");
    expect((await resultReceipt({ audio: "https://siroagent.com/media/a.mp3" })).kind).toBe("audio");
  });

  it("handles results that are not objects", async () => {
    expect((await resultReceipt(null)).sha).toBe(sha("null"));
    expect((await resultReceipt("plain")).kind).toBe("data");
  });
});

describe("mediaKeyOf", () => {
  it("reads the R2 key from a Siro media link", () => {
    expect(mediaKeyOf({ image: "https://siroagent.com/media/2026-11-26/z-image-turbo-abc.jpg" })).toBe("2026-11-26/z-image-turbo-abc.jpg");
  });

  it("ignores links that are not Siro media or try to climb out of the bucket", () => {
    expect(mediaKeyOf({ image: "https://example.com/pic.jpg" })).toBeNull();
    expect(mediaKeyOf({ image: "https://siroagent.com/media/../secret" })).toBeNull();
    expect(mediaKeyOf({ text: "no media" })).toBeNull();
  });
});

describe("proof payers", () => {
  it("are stored lowercase, so the lookup matches any checksum casing", () => {
    for (const p of PROOF_PAYERS) expect(p).toBe(p.toLowerCase());
  });
});
