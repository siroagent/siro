// The live quote on a spec sheet: one unpaid POST /v1/<id>. Siro answers 402 with the price on every
// network it can take payment on, and runs nothing, so asking is free.
import { PAY_KEYS, type PayNetworkKey } from "../../shared/catalog";
import { X402Error, readQuote, type Quote } from "../../shared/x402client";

export type LiveQuote = {
  at: Date;
  /** Round trip measured in this browser, request out to headers in. */
  ms: number;
  usd: number;
  networks: PayNetworkKey[];
  payTo: { address: string; networks: PayNetworkKey[] }[];
  /** maxTimeoutSeconds: how long a signed payment stays valid, grouped by network. */
  windows: { seconds: number; networks: PayNetworkKey[] }[];
  inputError?: string;
};

export class QuoteError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function liveQuote(id: string, input: unknown, timeoutMs = 10_000): Promise<LiveQuote> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`/v1/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input ?? {}), signal: ctl.signal });
  } catch {
    throw ctl.signal.aborted ? new QuoteError("timeout", `No quote came back within ${timeoutMs / 1000} s.`) : new QuoteError("unreachable", "The request did not reach the server.");
  } finally {
    clearTimeout(timer);
  }
  const ms = Math.round(performance.now() - t0);

  if (res.status !== 402) {
    const j = await res.json().catch(() => null);
    throw new QuoteError(j?.error?.code ?? `http_${res.status}`, j?.error?.message ?? `The server answered ${res.status} instead of a quote.`);
  }
  let q: Quote;
  try {
    q = await readQuote(res);
  } catch (e) {
    throw new QuoteError(e instanceof X402Error ? e.code : "not_x402", e instanceof Error ? e.message : "The server answered 402 without x402 payment details.");
  }

  const networks: PayNetworkKey[] = PAY_KEYS.filter((k) => q.accepts.some((a) => a.chain.key === k));
  if (!networks.length) throw new QuoteError("no_networks", "The quote named no network Siro can pay on.");
  const req = (k: PayNetworkKey) => q.accepts.find((a) => a.chain.key === k)!;
  const payTo = new Map<string, PayNetworkKey[]>();
  const windows = new Map<number, PayNetworkKey[]>();
  for (const k of networks) {
    const { payTo: to, maxTimeoutSeconds: s } = req(k);
    payTo.set(to, [...(payTo.get(to) ?? []), k]);
    windows.set(s, [...(windows.get(s) ?? []), k]);
  }

  return {
    at: new Date(),
    ms,
    usd: req(networks[0]).usd,
    networks,
    payTo: [...payTo].map(([address, keys]) => ({ address, networks: keys })),
    windows: [...windows].map(([seconds, keys]) => ({ seconds, networks: keys })),
    inputError: q.inputError?.message,
  };
}
