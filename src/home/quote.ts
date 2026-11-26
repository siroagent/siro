// The live quote: one unpaid POST to /v1/<id>. The server answers 402 and puts its terms in the
// payment-required header as base64 JSON. A decoded answer is kept for a minute per tool, so moving
// between pages does not ask the server again.
import { PAY_NETWORKS, payNetworkOf, type PayNetworkKey, type Resource } from "../../shared/catalog";

export type Accept = {
  scheme: string;
  network: string;
  /** 6-decimal base units, the same number on every network. */
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};
export type Required = {
  x402Version: number;
  error?: string;
  resource?: { url?: string; description?: string; mimeType?: string; iconUrl?: string };
  accepts: Accept[];
  extensions?: Record<string, unknown>;
  inputError?: { code: string; message: string };
};
/** One captured 402: when it came back, how long the round trip took, the raw header and its JSON. */
export type Capture = { id: string; at: number; ms: number; header: string; body: Required };

/** No 402 came back; the message says why in the server's own words when it gave any. */
export class NoQuote extends Error {}

const TTL = 60_000;
const slot = (id: string) => `siro.home.402.${id}`;

/** The request body a paid call would send: every catalog field that has an example. */
export function exampleInput(r: Resource): Record<string, string | number> {
  return Object.fromEntries(r.fields.filter((f) => f.example !== undefined).map((f) => [f.name, f.example!]));
}

export function cachedQuote(id: string): Capture | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(slot(id)) ?? "null") as Capture | null;
    return c && c.id === id && Date.now() - c.at < TTL && Array.isArray(c.body?.accepts) ? c : null;
  } catch {
    return null;
  }
}

function keep(c: Capture) {
  try {
    sessionStorage.setItem(slot(c.id), JSON.stringify(c));
  } catch {
    /* storage full or blocked: the next visit simply asks again */
  }
}

const decode = (b64: string): Required => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64.trim()), (ch) => ch.charCodeAt(0))));

export async function askQuote(r: Resource, signal: AbortSignal): Promise<Capture> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`/v1/${r.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(exampleInput(r)), signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new NoQuote("The request did not reach the server.");
  }
  const ms = Math.round(performance.now() - started);
  if (res.status !== 402) {
    const j = await res.json().catch(() => null);
    const said = j?.error?.message ?? (typeof j?.error === "string" ? j.error : null);
    throw new NoQuote(said ? `The server said: ${said}` : `The server answered ${res.status} instead of 402.`);
  }
  const header = res.headers.get("payment-required") ?? "";
  let body: Required | null = null;
  try {
    // The body repeats the header's JSON. It is left to finish loading rather than cancelled, so the
    // network log a developer opens shows a completed 402 instead of an aborted request.
    body = header ? decode(header) : await res.json();
  } catch {
    body = null;
  }
  if (!body || !Array.isArray(body.accepts) || !body.accepts.length) throw new NoQuote("The 402 came back without payment terms.");
  const c: Capture = { id: r.id, at: Date.now(), ms, header, body };
  keep(c);
  return c;
}

/** "20000" base units -> "0.02". Null when the amount is not a plain integer. */
export function unitsToUsd(units: string): string | null {
  if (!/^\d+$/.test(units)) return null;
  const s = units.replace(/^0+(?=\d)/, "").padStart(7, "0");
  const whole = s.slice(0, -6).replace(/^0+(?=\d)/, "");
  const frac = s.slice(-6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** The order every network list in the UI follows; Robinhood Chain is the default. */
export const UI_ORDER: PayNetworkKey[] = ["robinhood", "base", "solana", "arbitrum", "polygon"];

export function quotedNetworks(q: Required): PayNetworkKey[] {
  const keys = new Set(q.accepts.map((a) => payNetworkOf(a.network)));
  return UI_ORDER.filter((k) => keys.has(k));
}

/** The terms shown first: the earliest network in UI order, else whatever the server listed first. */
export function leadAccept(q: Required): Accept {
  for (const k of UI_ORDER) {
    const a = q.accepts.find((x) => payNetworkOf(x.network) === k);
    if (a) return a;
  }
  return q.accepts[0];
}

const either = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}` : (xs[0] ?? ""));

/** "USDG on Robinhood Chain, or USDC on Base, Solana or Arbitrum". */
export function networkText(keys: PayNetworkKey[]): string {
  const byAsset = new Map<string, string[]>();
  for (const k of keys) byAsset.set(PAY_NETWORKS[k].asset, [...(byAsset.get(PAY_NETWORKS[k].asset) ?? []), PAY_NETWORKS[k].name]);
  const parts = [...byAsset].map(([asset, names]) => `${asset} on ${either(names)}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, or ${parts.at(-1)}` : (parts[0] ?? "");
}

export const shortAddress = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** HH:MM in UTC. */
export const utc = (ms: number) => new Date(ms).toISOString().slice(11, 16);
