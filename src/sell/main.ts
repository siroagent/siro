// Sell a tool: the listing form, the owner controls, and the public page of one listing (/sell/<id>).
import { CATEGORIES, formatPrice, type Field } from "../../shared/catalog";
import { esc, mountShell, quietAsk, toast } from "../shell";
import "./sell.css";

mountShell("sell");

type Listing = {
  id: string;
  name: string;
  summary: string;
  categoryLabel: string;
  price: string;
  host: string;
  payTo: string;
  fields: Field[];
  returns: string;
  status: "live" | "paused" | "removed";
  url: string;
  page: string;
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const apiError = (j: any, status: number) => j?.error?.message ?? `Siro answered ${status}.`;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(apiError(j, r.status));
  return j;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied.");
  } catch {
    toast("Copy failed. Select the text and copy it by hand.");
  }
}

/** A JSON body with every field that has an example. */
const sample = (fields: Field[]) => Object.fromEntries(fields.filter((f) => f.example !== undefined).map((f) => [f.name, f.example]));

// ---- One listing: /sell/<id> ----

function listingView(l: Listing) {
  const body = JSON.stringify(sample(l.fields));
  const cli = `siro pay ${l.url} --post${l.fields
    .filter((f) => f.example !== undefined)
    .map((f) => ` ${f.name}=${/^[\w.:/@-]+$/.test(String(f.example)) ? f.example : `'${String(f.example).replace(/'/g, "'\\''")}'`}`)
    .join("")}`;
  const curl = `curl -i -X POST ${l.url} \\\n  -H 'content-type: application/json' \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
  const ask = `/ask?q=${encodeURIComponent(`Use the ${l.name} tool sold on Siro (${l.url}).`)}`;
  const rows = l.fields.length
    ? l.fields
        .map((f) => `<tr><th scope="row"><code class="inline">${esc(f.name)}</code>${f.required ? ' <span class="sl__req">required</span>' : ""}</th><td>${esc(f.type === "enum" ? `one of ${f.options?.join(", ")}` : f.type)}</td><td>${esc(f.description)}${f.example !== undefined ? `<br><span class="sl__ex">e.g. ${esc(f.example)}</span>` : ""}</td></tr>`)
        .join("")
    : `<tr><td colspan="3">No input. Send an empty JSON object.</td></tr>`;
  document.title = `${l.name} · Sell a tool · Siro`;
  $("sl-head").innerHTML = `<p class="label sl__crumb"><a href="/sell">Sell a tool</a> · sold by ${esc(l.host)}</p>
<h1>${esc(l.name)}</h1>
<p class="lede">${esc(l.summary)}</p>`;
  const box = $("sl-listing");
  box.innerHTML = `
<dl class="sl__spec sl__spec--listing">
  <div><dt>Price</dt><dd class="live-num">${esc(formatPrice(l.price))} <small>per call</small></dd></div>
  <div><dt>Status</dt><dd>${l.status === "live" ? "Live" : "Paused by the seller, or after five failed calls in a row"}</dd></div>
  <div><dt>Category</dt><dd>${esc(l.categoryLabel)}</dd></div>
  <div><dt>Returns</dt><dd><code class="inline">${esc(l.returns)}</code></dd></div>
  <div><dt>Paid to</dt><dd><code class="inline sl__addr">${esc(l.payTo)}</code><br><span class="sl__ex">The seller's own address, named in https://${esc(l.host)}/.well-known/siro.json. Siro never holds the payment.</span></dd></div>
</dl>
<h2 class="h3 sl__sub">Input</h2>
<table class="table sl__table"><thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">What it is</th></tr></thead><tbody>${rows}</tbody></table>
<h2 class="h3 sl__sub">Call it</h2>
<p class="sl__note">Without a payment the endpoint answers 402 with the quote. A failed call is not charged.</p>
<div class="sl__calls">
  <figure class="sl__snip display"><figcaption class="display__bar"><b>Siro CLI</b><button class="key key--sm" type="button" data-copy="cli">Copy</button></figcaption><pre><code>${esc(cli)}</code></pre></figure>
  <figure class="sl__snip display"><figcaption class="display__bar"><b>curl, for the 402 quote</b><button class="key key--sm" type="button" data-copy="curl">Copy</button></figcaption><pre><code>${esc(curl)}</code></pre></figure>
</div>
<p class="sl__keys"><a class="key key--ink" href="${esc(ask)}">Use it in Ask</a><a class="key" href="/sell">List your own tool</a></p>`;
  box.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy === "cli" ? cli : curl)));
  box.hidden = false;
  $("sl-sell").hidden = true;
  // While this page's own dark key is in view, the rail's and the dock's Ask step back.
  quietAsk(box.querySelector(".sl__keys"));
}

function missing(id: string) {
  document.title = "No such listing · Siro";
  $("sl-head").innerHTML = `<p class="label sl__crumb"><a href="/sell">Sell a tool</a></p><h1>No such listing</h1><p class="lede">Nothing is listed as <code class="inline">${esc(id.slice(0, 60))}</code>, or its seller removed it. Listed tools are also on the <a href="/tools">Tools</a> page.</p>`;
  $("sl-sell").hidden = true;
}

// ---- The listing form ----

const TYPES: [Field["type"], string][] = [
  ["string", "Text"],
  ["number", "Number"],
  ["enum", "Choice"],
  ["url", "Link"],
];
let fieldN = 0;

function addField(f: Partial<Field> = {}) {
  const list = $("sl-fields");
  if (list.children.length >= 8) return toast("8 fields at most.");
  const n = ++fieldN;
  list.insertAdjacentHTML(
    "beforeend",
    `<div class="sl__frow" data-field>
  <label class="field"><span>Field name</span><input name="f-name" value="${esc(f.name ?? "")}" spellcheck="false" autocomplete="off" placeholder="text" pattern="[a-z][a-z0-9_]*"></label>
  <label class="field"><span>Type</span><select name="f-type">${TYPES.map(([v, t]) => `<option value="${v}"${f.type === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
  <label class="field sl__fwide"><span>What it is</span><input name="f-desc" value="${esc(f.description ?? "")}" placeholder="The text to summarize."></label>
  <label class="field"><span>Example</span><input name="f-ex" value="${esc(f.example ?? "")}" placeholder="e.g. Paste a contract…"></label>
  <label class="field sl__fopts" hidden><span>Options, comma separated</span><input name="f-opts" value="${esc(f.options?.join(", ") ?? "")}" placeholder="short, long"></label>
  <label class="sl__freq"><input type="checkbox" name="f-req"${f.required ? " checked" : ""}> Required</label>
  <button class="key key--sm sl__fdel" type="button" data-del aria-label="Remove field ${n}">Remove</button>
</div>`,
  );
  const row = list.lastElementChild as HTMLElement;
  const type = row.querySelector<HTMLSelectElement>("[name=f-type]")!;
  const sync = () => (row.querySelector<HTMLElement>(".sl__fopts")!.hidden = type.value !== "enum");
  type.addEventListener("change", sync);
  sync();
  row.querySelector("[data-del]")!.addEventListener("click", () => {
    row.remove();
    ($("sl-add") as HTMLButtonElement).focus();
  });
}

function readFields() {
  return [...document.querySelectorAll<HTMLElement>("[data-field]")]
    .map((row) => {
      const v = (n: string) => row.querySelector<HTMLInputElement>(`[name=${n}]`)!.value.trim();
      const type = v("f-type");
      return {
        name: v("f-name"),
        type,
        description: v("f-desc"),
        required: row.querySelector<HTMLInputElement>("[name=f-req]")!.checked,
        example: v("f-ex") || undefined,
        options: type === "enum" ? v("f-opts").split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      };
    })
    .filter((f) => f.name || f.description);
}

function setBusy(b: HTMLButtonElement, busy: boolean, label: string) {
  b.disabled = busy;
  b.textContent = label;
}

function done(l: Listing, secret: string, test: string) {
  const box = $("sl-done");
  box.innerHTML = `<div class="display__bar"><b>Listed: ${esc(l.name)}</b><span>${esc(formatPrice(l.price))} per call</span></div>
<div class="sl__done-body">
  <p><b>Copy the secret now.</b> Siro will not show it again. Check it on every call as <code class="inline">x-siro-secret</code>, and use it to pause or remove the listing.</p>
  <div class="sl__secret"><code id="sl-secret">${esc(secret)}</code><button class="key key--sm" type="button" data-copy-secret>Copy secret</button></div>
  <dl class="sl__spec">
    <div><dt>Paid endpoint</dt><dd><code class="inline">${esc(l.url)}</code></dd></div>
    <div><dt>Public page</dt><dd><a href="/sell/${encodeURIComponent(l.id)}">${esc(l.page.replace("https://", ""))}</a></dd></div>
    <div><dt>Listing id</dt><dd><code class="inline">${esc(l.id)}</code></dd></div>
    <div><dt>Test call answered</dt><dd><code class="inline">${esc(test)}</code></dd></div>
  </dl>
  <p class="sl__note">Agents find it through Siro discovery: Ask, the MCP server, <code class="inline">siro discover</code> and /api/discover.</p>
</div>`;
  box.querySelector("[data-copy-secret]")!.addEventListener("click", () => copy(secret));
  box.hidden = false;
  $("sl-form").hidden = true;
  box.focus();
}

function mountForm() {
  const form = $<HTMLFormElement>("sl-form");
  $("sl-cat").innerHTML = Object.entries(CATEGORIES)
    .map(([k, v]) => `<option value="${k}"${k === "content" ? " selected" : ""}>${esc(v)}</option>`)
    .join("");
  addField({ name: "text", type: "string", description: "The text to work on.", required: true });
  $("sl-add").addEventListener("click", () => {
    addField();
    document.querySelector<HTMLInputElement>("[data-field]:last-child [name=f-name]")?.focus();
  });

  const val = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value.trim();
  const check = $<HTMLButtonElement>("sl-check");
  check.addEventListener("click", async () => {
    const out = $("sl-check-out");
    setBusy(check, true, "Checking…");
    out.textContent = "";
    try {
      const j = await post("/api/sell/check", { endpoint: val("endpoint"), payTo: val("payTo") });
      out.textContent = `Found. https://${j.host}/.well-known/siro.json names ${j.payTo}.`;
    } catch (e: any) {
      out.textContent = e.message;
    } finally {
      setBusy(check, false, "Check siro.json");
    }
  });

  const submit = $<HTMLButtonElement>("sl-submit");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const out = $("sl-out");
    setBusy(submit, true, "Checking and test-calling…");
    out.textContent = "Siro is reading siro.json and calling your endpoint once. This can take up to 25 seconds.";
    try {
      const j = await post("/api/sell", {
        endpoint: val("endpoint"),
        payTo: val("payTo"),
        name: val("name"),
        price: val("price"),
        summary: val("summary"),
        category: val("category"),
        returns: val("returns"),
        fields: readFields(),
      });
      out.textContent = "";
      done(j.listing, j.secret, j.test);
    } catch (e: any) {
      out.textContent = e.message;
    } finally {
      setBusy(submit, false, "List the tool");
    }
  });

  const own = $<HTMLFormElement>("sl-own");
  own.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const b = (ev as SubmitEvent).submitter as HTMLButtonElement | null;
    const status = b?.value ?? "paused";
    const id = (own.elements.namedItem("id") as HTMLInputElement).value.trim();
    const secret = (own.elements.namedItem("secret") as HTMLInputElement).value.trim();
    const out = $("sl-own-out");
    if (!id || !secret) return void (out.textContent = "Enter the listing id and its secret.");
    if (status === "removed" && !confirm(`Remove ${id}? It cannot be listed again under this id.`)) return;
    out.textContent = "Saving…";
    try {
      await post(`/api/listings/${encodeURIComponent(id)}/status`, { status }, { "x-siro-secret": secret });
      out.textContent = status === "live" ? `${id} is live again.` : status === "paused" ? `${id} is paused. Calls answer 503 and nobody is charged.` : `${id} is removed.`;
    } catch (e: any) {
      out.textContent = e.message;
    }
  });
}

const m = location.pathname.match(/^\/sell\/([^/]+)\/?$/);
if (m) {
  const id = decodeURIComponent(m[1]);
  $("sl-sell").hidden = true;
  fetch(`/api/listings/${encodeURIComponent(id)}`)
    .then(async (r) => (r.ok ? listingView(await r.json()) : missing(id)))
    .catch(() => missing(id));
} else mountForm();
