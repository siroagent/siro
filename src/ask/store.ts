// Saved chats. They live in this browser only (localStorage "siro.chats", the same key the earlier
// chat app used, so old conversations still open). A quote is kept as data, not markup, so an open
// quote can still be approved after a reload.
import type { NetworkKey, PayNetworkKey } from "../../shared/catalog";
import type { SwapQuote } from "../../shared/swap";
import { uid } from "./format";

export type ResourceProposal = { kind: "resource"; resource: string; name: string; price: string; category: string; input: Record<string, unknown> };
export type ExternalProposal = { kind: "external"; name: string; url: string; method: string; price: string; description: string; input: Record<string, unknown> };
export type SwapProposal = { kind: "swap"; network: NetworkKey; from: string; to: string; amount: string };
export type Proposal = ResourceProposal | ExternalProposal | SwapProposal;

/** What stands between an open quote and a payment. */
export type Issue =
  | "no_budget"
  | "no_wallet"
  | "wallet_solana"
  | "slow_solana"
  | "over_call"
  | "over_day"
  | "over_swap"
  | "no_usd"
  | "funds"
  | "price";

export type Settlement = {
  usd: number | null;
  network: PayNetworkKey;
  tx: string | null;
  asset?: string;
  /** Broadcast but not confirmed when the result came back. */
  pending?: boolean;
  /** The service answered without asking for a payment. */
  free?: boolean;
  /** Swaps: the least the route promised to deliver. */
  min?: string;
};

export type Quote = {
  p: Proposal;
  state: "open" | "busy" | "settled" | "declined" | "failed";
  /** While busy: what is running. */
  step?: "route" | "pay" | "approving" | "building" | "swapping";
  issue?: Issue;
  /** Why a quote was declined or failed. */
  why?: "you" | "wallet" | "replaced" | "network" | "interrupted" | "no_route" | "error";
  /** The server's, the service's or the wallet's own words. */
  detail?: string;
  /** price_changed: the price that was shown before the server quoted more. */
  was?: string;
  receipt?: Settlement;
  sq?: SwapQuote | null;
  /** Autopay already paid once for this message, so this quote waits for a hand approval. */
  manual?: boolean;
};

export type Msg = {
  id: string;
  role: "user" | "assistant" | "tool";
  /** What the agent reads. Empty for a quote. */
  content: string;
  at?: number;
  /** Rendered HTML of a tool result (and of quote cards saved by the earlier chat app). */
  ui?: string;
  quote?: Quote;
  /** A user message that asked to be quoted with this tool id. */
  tool?: string;
  /** Shown in the transcript, never sent to the agent (for example "the agent did not answer"). */
  notice?: boolean;
};

export type Chat = { id: string; title: string; at: number; msgs: Msg[] };

const KEY = "siro.chats";
const KEEP = 40;
// Generated images and audio stay on screen but not in history: localStorage holds about 5 MB.
const INLINE_MEDIA = /data:(image|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{2000,}/g;

export function newChat(): Chat {
  return { id: uid(), title: "New chat", at: Date.now(), msgs: [] };
}

export function loadChats(): Chat[] {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter((c) => c && typeof c === "object" && Array.isArray(c.msgs)).map(normalize);
}

function normalize(c: any): Chat {
  const msgs: Msg[] = c.msgs
    .filter((m: any) => m && typeof m === "object" && typeof m.content === "string" && ["user", "assistant", "tool"].includes(m.role))
    .map((m: any) => {
      const out: Msg = { ...m, id: typeof m.id === "string" ? m.id : uid() };
      // A quote saved mid-payment or mid-route: the page closed before the outcome came back.
      if (out.quote?.state === "busy")
        out.quote =
          out.quote.step === "route"
            ? { ...out.quote, state: "failed", why: "no_route", detail: "This page closed before KyberSwap sent a route. Get a new quote to see one.", step: undefined }
            : { ...out.quote, state: "failed", why: "interrupted", step: undefined };
      return out;
    });
  return { id: typeof c.id === "string" ? c.id : uid(), title: typeof c.title === "string" && c.title ? c.title : "Chat", at: Number(c.at) || Date.now(), msgs };
}

export function saveChats(chats: Chat[]) {
  try {
    const keep = chats
      .filter((c) => c.msgs.length)
      .sort((a, b) => b.at - a.at)
      .slice(0, KEEP);
    localStorage.setItem(KEY, JSON.stringify(keep, (k, v) => (k === "ui" && typeof v === "string" ? v.replace(INLINE_MEDIA, "data:,") : v)));
  } catch {
    /* storage full or blocked: the chat lives for this visit only */
  }
}

/** The first line of the first message, cut to fit the app bar and the drawer. */
export function titleFrom(text: string) {
  const line = text.trim().split(/\r?\n/)[0];
  return line.length > 56 ? `${line.slice(0, 55).trimEnd()}…` : line || "Chat";
}
