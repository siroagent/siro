// Paid results shown in full: /api/proofs lists calls the Siro team paid for itself, each with the exact
// result it returned. The section stays hidden until there is at least one.
import { PAY_NETWORKS, byId, payNetworkOf } from "../../shared/catalog";
import { esc } from "../shell";

export type Proof = {
  id: number;
  resource: string;
  network: string;
  payer: string;
  usd: number;
  tx: string;
  ms: number | null;
  at: number;
  resultSha: string;
  resultBytes: number;
  resultKind: "text" | "image" | "video" | "audio" | "data";
  cut: boolean;
  result: unknown;
};

const TEXT_CLIP = 1_400;
const JSON_CLIP = 1_600;
const httpsUrl = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : null);

export const size = (b: number) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(b < 10_240 ? 1 : 0)} KB`);

function body(p: Proof) {
  const o = (p.result && typeof p.result === "object" ? p.result : {}) as Record<string, unknown>;
  const name = esc(byId(p.resource)?.name ?? p.resource);
  const img = httpsUrl(o.image);
  if (p.resultKind === "image" && img) return `<img class="proof__media" src="${esc(img)}" alt="Image returned by ${name}" loading="lazy" decoding="async">`;
  const vid = httpsUrl(o.video);
  if (p.resultKind === "video" && vid) return `<video class="proof__media" src="${esc(vid)}" controls preload="metadata" playsinline></video>`;
  const aud = httpsUrl(o.audio);
  if (p.resultKind === "audio" && aud) return `<audio class="proof__audio" src="${esc(aud)}" controls preload="none"></audio>`;
  if (p.resultKind === "text" && typeof o.text === "string") {
    const t = o.text.length > TEXT_CLIP ? `${o.text.slice(0, TEXT_CLIP)}…` : o.text;
    return `<p class="proof__text">${esc(t)}</p>`;
  }
  const json = JSON.stringify(p.result, null, 2) ?? "";
  return `<pre class="proof__json">${esc(json.length > JSON_CLIP ? `${json.slice(0, JSON_CLIP)}\n…` : json)}</pre>`;
}

function card(p: Proof, when: (at: number) => string, dollars: (v: number) => string) {
  const tool = byId(p.resource);
  const net = payNetworkOf(p.network);
  const netName = net ? PAY_NETWORKS[net].name : p.network;
  const tx = `${p.tx.slice(0, 8)}…${p.tx.slice(-6)}`;
  const txLink = net
    ? `<a class="act__hash" href="${esc(`${PAY_NETWORKS[net].explorer}/tx/${encodeURIComponent(p.tx)}`)}" target="_blank" rel="noopener noreferrer">${esc(tx)}<span class="sr">, opens in a new tab</span></a>`
    : `<span class="act__hash">${esc(tx)}</span>`;
  const json = JSON.stringify(p.result, null, 2) ?? "";
  return `<li class="proof" id="r-${esc(p.tx)}">
<header class="proof__head">
  <h3>${tool ? `<a href="/tools/${encodeURIComponent(tool.id)}">${esc(tool.name)}</a>` : esc(p.resource)}</h3>
  <p class="proof__paid"><b class="live-num">${dollars(p.usd)}</b> on ${esc(netName)} · <time datetime="${new Date(p.at * 1000).toISOString()}">${when(p.at)}</time>${p.ms != null ? ` · ran ${(p.ms / 1000).toFixed(1)} s` : ""}</p>
</header>
<div class="proof__out">${body(p)}</div>
<dl class="proof__facts">
  <div><dt>Paid in</dt><dd>${txLink}</dd></div>
  <div><dt>Result sha256</dt><dd class="mono" title="${esc(p.resultSha)}">${esc(p.resultSha.slice(0, 16))}…</dd></div>
  <div><dt>Size</dt><dd>${size(p.resultBytes)} ${esc(p.resultKind)}</dd></div>
</dl>
<details class="proof__raw"><summary>Exact JSON returned${p.cut ? " (first 64 KB)" : ""}</summary><pre class="proof__json">${esc(json)}</pre></details>
</li>`;
}

export async function paintProofs(when: (at: number) => string, dollars: (v: number) => string) {
  const section = document.getElementById("proofs");
  const list = document.getElementById("proofs-list");
  if (!section || !list) return;
  try {
    const res = await fetch("/api/proofs");
    if (!res.ok) return;
    const { proofs } = (await res.json()) as { proofs: Proof[] };
    if (!proofs.length) return;
    list.innerHTML = proofs.map((p) => card(p, when, dollars)).join("");
    // Generated media is kept 7 days (see /privacy). An expired file says so instead of showing a broken frame;
    // the sha256 and the JSON below still prove what the call returned.
    list.querySelectorAll<HTMLElement>(".proof__media, .proof__audio").forEach((m) =>
      m.addEventListener(
        "error",
        () => {
          const p = document.createElement("p");
          p.className = "proof__text";
          p.textContent = "This file was deleted after 7 days, as every generated file is. The hash below still matches the result.";
          m.replaceWith(p);
        },
        { once: true },
      ),
    );
    section.hidden = false;
  } catch {
    // The section is extra proof on top of the ledger; when it cannot be read it stays hidden.
  }
}
