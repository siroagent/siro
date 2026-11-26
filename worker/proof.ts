// Result receipts. Every settled call records sha256(JSON.stringify(result)), its byte size and its kind,
// and the same hash goes back to the payer in the receipt. Calls paid by the Siro team's own wallets also
// keep the full result, so /activity can show what a paid call returns without exposing anyone else's.

/** Wallets the Siro team pays from. Their calls are tests and demos, so their results are public. */
export const PROOF_PAYERS = new Set(["0x77875ca3e5077493d8b2d4f273d7d4a740da70ad", "0xa6f3f0702ccc817436983e78250df00b28d4ba17"]);
const MAX_PROOF_BYTES = 65_536;

export type ResultReceipt = { sha: string; bytes: number; kind: "text" | "image" | "video" | "audio" | "data"; json: string; mediaKey: string | null };

/** The R2 key of a file Siro stored for this result (an https://…/media/<key> link), or null. */
export function mediaKeyOf(result: unknown): string | null {
  const o = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  for (const k of ["image", "video", "audio"]) {
    const m = typeof o[k] === "string" ? /^https:\/\/[^/]+\/media\/([\w./-]{1,200})$/.exec(o[k] as string) : null;
    if (m && !m[1].includes("..")) return m[1];
  }
  return null;
}

export async function resultReceipt(result: unknown): Promise<ResultReceipt> {
  const json = JSON.stringify(result) ?? "null";
  const raw = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const o = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const kind = typeof o.image === "string" ? "image" : typeof o.video === "string" ? "video" : typeof o.audio === "string" ? "audio" : typeof o.text === "string" ? "text" : "data";
  return { sha, bytes: raw.byteLength, kind, json, mediaKey: mediaKeyOf(result) };
}

/** The settlement insert with the receipt columns, plus the full result when a team wallet paid. */
export function settlementStatements(db: D1Database, s: { resource: string; network: string; payer: string; amount: number; tx: string; ms: number }, rr: ResultReceipt) {
  const out = [
    db
      .prepare("INSERT INTO settlements (resource, network, payer, amount, tx, ms, at, result_sha, result_bytes, result_kind, media_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
      .bind(s.resource, s.network, s.payer, s.amount, s.tx, s.ms, Math.floor(Date.now() / 1000), rr.sha, rr.bytes, rr.kind, rr.mediaKey),
  ];
  if (PROOF_PAYERS.has(s.payer.toLowerCase())) {
    const cut = rr.json.length > MAX_PROOF_BYTES;
    out.push(db.prepare("INSERT INTO proofs (tx, result, cut) VALUES (?1, ?2, ?3) ON CONFLICT (tx) DO NOTHING").bind(s.tx, cut ? rr.json.slice(0, MAX_PROOF_BYTES) : rr.json, cut ? 1 : 0));
  }
  return out;
}
