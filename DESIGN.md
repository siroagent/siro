# Siro design: "Instrument"

Chosen by the owner on 15 Nov 2026 (option A of the redesign study). This file is the single source of truth for every page. Owner constraints: keep black/white + the S logo, add a slight silver tone and real shadows (not flat 2D like Xona), modern menu names, a layout that no longer reads like Xona, futuristic and professional.

Design read: product site + web app for an x402 agent-payments stack, for crypto traders (X, GMGN) and developers wiring agents, in a machined-instrument style (light silver bench, raised aluminium faceplates, recessed graphite displays, low keys, one chrome ball). Dial: **ENERGY 2 / RHYTHM 2 / MOTION 2**.

- ENERGY 2: energy comes from material and live numbers, never from colour.
- RHYTHM 2: airy explanation on the bench alternates with dense instruments, and each instrument has its own shape (price display, knob + ruler, transcript, photo + strip, code display).
- MOTION 2: motion only reports state (the ball follows a measured 402 round trip, keys sink 1px when pressed, the nav shadow appears once content scrolls under it). No scroll pinning, parallax, loops, count-ups or fade-ups. Every JS animation checks `matchMedia('(prefers-reduced-motion: reduce)')` first.

## Names and routes

| Old | New | Route |
|---|---|---|
| Siro App, "Open Siro App" | **Ask**, CTA "Ask Siro" | `/ask` (301 from `/app`). `/ask?tool=<id>&q=<text>` prefills a quote slip; nothing is sent before Send |
| Siro Wallet | **Budget** (page title "Budget · agent wallet and caps") | `/budget` (301 from `/wallet`) |
| Siro Resources | **Tools** | `/tools`, `/tools/:id`, `/tools?c=image` (301 from `/resources...`). The API stays `/v1/resources` |
| Ledger | **Activity** | `/activity` (301 from `/ledger`) |
| Docs | **Docs** | `/docs`, old anchors kept |
| Roadmap (main nav) | **Shipped** (footer only) | `/shipped` (301 from `/roadmap`) |
| Inference Marketplace | **Sell a tool** | `/shipped#sell-a-tool` |

Never write "Siro App", "Siro Wallet", "Siro Resources", "Open Siro App", "Ledger" (a hardware-wallet brand) or Xona's phrases ("Limits that hold", "Your keys, your money", "Give your agent a wallet", "One wallet, every network", "Ask in plain language", "Finds what it needs").

## Material, colour, elevation

Light theme only (renders are baked onto light surfaces; graphite already means "live").

| Token | Value | Use |
|---|---|---|
| `--bench` | `#F2F3F5` | page background |
| `--paper` | `#FFFFFF` | explanation blocks, dialogs |
| `--plate` | `#ECEEF1` | flat plates that hold a render (renders are baked to exactly this) |
| `--face-hi` → `--face-lo` | `#EEF0F3` → `#E1E4E8` | raised aluminium faceplates, one-direction gradient (lit from above), with a 14px specular band (`#F7F8FA`) at the top edge so the metal reads as silver, not grey (owner asked for a silver tone and depth) |
| `--hair` | `#C9CED4` | decorative hairlines only |
| `--edge` | `#727A84` | control borders (3.41:1 on face-lo) |
| `--ink` | `#101215` | text, 16.9:1 on bench |
| `--ink-2` | `#383D44` | secondary text |
| `--label` | `#565D67` | labels, captions (5.2:1 on face-lo) |
| `--display` / `--display-bay` | `#141619` / `#1B1E22` | recessed graphite displays |
| `--on-display` / `--on-display-2` | `#E9ECEF` / `#9EA6AF` | text on displays |
| `--display-edge` | `#737B85` | borders on displays |

Status colour only for states, always with a word next to it. On light: settled `#146A44`, awaiting `#855600`, refused `#AE3328`. On displays: `#4CC38A`, `#E5B23A`, `#FF8A7A`.

Elevation (what sits above what). No glow, no noise, no backdrop blur, cards never lift on hover.

- **L-1 recessed**: graphite displays, fields, the search well. `inset 0 2px 8px rgba(0,0,0,.55), inset 0 0 0 1px rgba(0,0,0,.7)` plus a light lip `0 1px 0 rgba(255,255,255,.7)` under the opening.
- **L0 bench**: text, tables. No shadow.
- **Display bezel**: graphite displays sit in a 1px machined seam (`#B8BEC6`) inside a 1px light lip, so each reads as a screen set into metal.
- **L1 raised**: faceplates and render plates. `inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 1px rgba(16,20,26,.07), 0 1px 2px rgba(16,20,26,.08), 0 12px 28px -16px rgba(16,20,26,.28)`.
- **Key** (pressable): `inset 0 1px 0 rgba(255,255,255,.9), 0 1px 1px rgba(16,20,26,.16), 0 2px 6px -2px rgba(16,20,26,.2)`; pressed: `inset 0 1px 3px rgba(16,20,26,.3)` and 1px down.
- **L2**: nav rail and mobile dock over scrolling content, `0 10px 30px -18px rgba(16,20,26,.4)`, only after scroll.
- **L3**: palette, sheets, dialogs, toasts: `0 8px 20px rgba(16,20,26,.14), 0 32px 80px -24px rgba(16,20,26,.45)` with scrim `rgba(16,20,26,.32)`, no blur.

Specular: the chrome ball is an SVG with four layers (bright sky top, dark horizon band below reflecting the rail, sharp specular top-left, rim light bottom-right) plus a contact shadow, light from top-left. Graphite displays get a 5% glass sheen on the top edge. Graphite keys: gradient `#2B2F35 → #17191C` plus a 14% inner highlight.

## Type

- **SF Pro** (the Apple system face) wherever it is installed, **Inter** variable with its optical-size axis, self-hosted, everywhere else. Owner asked on 16 Nov 2026 for premium, Apple-style type. Live numbers (prices, latency, balances) are semibold with `tabular-nums`, `-0.03em`, and a smaller unit after. H1 `clamp(40px,5vw,72px)/1.0`, 600, `-0.035em`; H2 `clamp(28px,3.2vw,44px)`, `-0.03em`; body 17/28 (16/26 on phones); labels 13px sentence case.
- The home H1 alone is larger (`clamp(48px,6.2vw,96px)/0.94`, 650, `-0.04em`) and filled with the chrome of the ball: dark, a bright horizon band just under the middle of each line, dark again. Its lightest band still holds 4.4:1 on the bench.
- **Atkinson Hyperlegible Mono** only for hashes, addresses, endpoints, JSON, CLI.
- Headings are one colour (no black + grey two-tone headline). No wide-tracked uppercase. Prices show at least two decimals (`$0.60`, not `$0.6`).

## Grid and spacing

12 columns, max 1320px, gutter 24px, outer margin 32/24/16px. Breakpoints come from content: 560 (faceplate zones stack), 760 (rail becomes dock), 1100 (five keys + Search fit). 4px base. Section padding 112/72 desktop, 72/48 tablet, 48/32 phone. Touch targets 44px with ≥8px gaps.

## Components

- **Key**: square, radius 4px, 40px tall (44px touch). Raised aluminium by default; graphite for the one primary action per screen. Pressed = 1px down + inset shadow. Disabled = dashed edge plus a written reason ("Not live yet").
- **Field**: recessed well 44px, visible label above, USD unit, numbers right-aligned.
- **Display**: recessed graphite panel with a 36px top bar (name left, source + UTC time right).
- **Lamp**: 8px square + a word.
- **Meter**: two rails + the ball at the value.
- **Table**: 36/44px rows, hairlines, sticky header, `aria-sort`, no zebra, no three-dot menus.
- **Dialog / sheet**: white plate at L3, focus trapped, Escape closes.
- **Focus**: double-rail ring (two 1px lines, 2px apart), graphite on light, `#E9ECEF` on displays.

Identity motif: **rails + ball**. Two parallel lines always mean a boundary (focus, active page, cap line, meter); an ordinary divider is one hairline. Rails snap to device pixels. The chrome ball always means "where something is now" and appears only in the hero, meters, the active page key and the newest settlement row. Round things move (ball, knob); everything else is square. The S is always engraved into metal, never floating.

## Navigation

- **Desktop ≥1100px**: a full-width aluminium rail fixed to the top, 60px, `--face-hi → --face-lo`, 1px top highlight, double rail at the bottom. Left: engraved S + wordmark "siro". Then five keys: **Ask** (filled graphite, also the CTA, so no separate "Open..." button), Tools, Budget, Activity, Docs. Active page = pressed key + a 6px chrome ball at its left edge. Right: recessed search well "Search ⌘K" (~200px) and an X icon labelled "Siro on X". No dropdowns, theme or language toggles, or sign-up. On home the Ask key renders aluminium while the hero is visible, so the first screen has one dark button. L2 shadow only after scrolling.
- **760–1099px**: S, Ask, Tools, Budget, a labelled "More" key (Activity, Docs, Shipped, X) and Search.
- **<760px**: thin header (S + Search) that scrolls away; a fixed aluminium bottom dock 56px + safe area with five labelled keys: Ask (filled, the only dark button), Tools, Budget, Activity, Menu. Pages get bottom padding so the last row is never covered.
  - Dock glyphs, each tied to what its key holds, drawn in 1.6px square strokes like the rails: a speech outline for Ask (a conversation), a 2×2 grid for Tools (a catalog), two rails with the ball for Budget (the caps meter), ledger lines for Activity (rows of settlements), two lines for Menu.
- On `/ask` the rail becomes a 48px app bar and the dock is hidden.
- **Search (⌘K / Ctrl K)** opens an L3 dialog: pages with a one-line descriptor, all tools (name, maker, price), Docs sections; old words (app, wallet, resources, ledger, roadmap) are aliases. Phase 1: a plain filtered list of links with arrow-key movement.

## Home

1. **Quote faceplate (hero)**. Title band on the bench: H1 "The price comes first." left (cols 1–7, max 72px so it is not the focus); right (cols 8–12, top-aligned) the sub "Each tool quotes its price over x402 before it runs. Your agent pays from a capped budget, only when the result comes back." with "Ask Siro" and "67 tools from $0.001" (count and cheapest price come from the catalog). Below, one full-width aluminium faceplate (L1, height `min(420px, 100svh - 300px)`) with two zones:
   - Left (cols 1–7): recessed graphite display. Top bar: a tool select + measured latency. Focus: the price in Archivo width 125, tabular, sized to its container (clamp 56–104px). Under it the cap verdict (lamp + words), then a footer line "Nothing is charged here. You sign in Ask, after your yes."
   - Right (cols 8–12): the S engraved as a channel in the aluminium, the chrome ball in it, six small stations Brief · Quote · Cap · Sign · Run · Settle (the last three dashed: "in Ask, after your yes"), and two rail meters (per call, today).
   - Faceplate foot: "x402 v2 · POST /v1/prediction-read · quoted 14:05 UTC" + key "Copy curl".
   - Real data: an unpaid POST to `/v1/<id>` with the catalog example input; decode the 402 (amount, network, payTo, maxTimeoutSeconds); latency measured in the browser; caps read from localStorage (`siro.agent.limits`) through a tiny module with no viem, else the new-wallet defaults ($0.10 a call, $1.00 a day), and the verdict names its source. Select: Prediction Read $0.02 (default), Stock Token Signal $0.02, Market Brief $0.03, Aura 2 Voice $0.04, Nano Banana 2.1 $0.045, Seedance 2.0 Mini $0.25 (the one refused under default caps, labelled).
   - Ball rests at Brief, moves to Quote for the real round trip (min 240ms), to Cap 280ms, then stops.
   - States: catalog price shows at once labelled "price list"; >2 s "Still waiting. The server is warming up."; >10 s or failure "No quote came back. Showing the price list." + Retry; without JS the catalog price is printed at build + "Live quote needs JavaScript". One automatic probe per session, cached 60 s.
   - Verdicts: "Within a new wallet's default caps: $0.10 a call, $1.00 a day." / "Within your caps: $0.02 of $0.10 a call, $0.02 of $1.00 today." / "Over $0.10 a call. Siro refuses before signing. Raise it in Budget."
   - Phone: H1 on two lines at 34px, then price display + verdict within the first 390×844 screen above the dock; select below; the S gauge becomes a one-line station strip; sub under the faceplate; no hero buttons (the dock has Ask).
2. **"Two rails, one route."** Render 01 as a framed figure on a flat plate (baked to `--plate`, max 900px; the owner kept the plate on 16 Nov 2026) with four engraved leader lines: this rail = cap per call, that rail = cap per day, the ball = one payment, the channel = the route Brief → Settle. One paragraph: the logo is the safety rule.
3. **"Turn the cap. See what still fits."** Knob 03 (clip-path circle(44%), baked to the faceplate mid tone) as a per-call cap slider, log scale $0.001–$1.00 with 1-2-5 detents, arrows/Home/End and −/+ keys 44px, beside a graphite display with a ruler of all catalog prices; "At $0.10 a call, N of 67 tools run." computed from the catalog; key "Use this cap in Budget".
4. **"Asking is free. Paying waits for your yes."** A transcript column using the real quote component in specimen mode (inert, no fake buttons) with Nano Banana 2.1 at its catalog price; margin notes joined by hairlines; link "Try this in Ask" (prefill, no auto-send).
5. **"No result, no charge."** Macro 06 on a bounded plate (≤1200px), heading + text under the photo, joined to a one-line graphite Activity strip ("No settlements yet. The first paid call appears here with its transaction hash.") that grows to 8 rows once real settlements exist.
6. **"Three ways in. One price list."** A graphite display with HTTP / CLI / MCP segment keys, real snippets + Copy, and a panel "The response your agent gets" showing the 402 the hero captured. No window dots, no typing animation.
7. **Close**: a thin faceplate strip, no render: "Start at $0.10 a call and $1.00 a day." + keys "Ask Siro" and "Set a budget".
8. **Footer**: one aluminium strip, not four columns: S + one sentence; links grouped on one line (Use: Ask, Tools, Budget · Check: Activity, Shipped · Build: Docs, Sell a tool, Catalog JSON, MCP, CLI · the official X mark alone, labelled "Siro on X (@siro_agent)"); a status line from one `/api/stats` fetch ("67 tools live · 5 networks quoting · checked 14:05 UTC"); legal line.

## Other pages

- **Ask** (`/ask`): operator layout. 48px app bar (S to home, chat title, Chats key opening a left drawer, payer + network, Budget key). Left: transcript on the bench (max 720px, role + UTC time in the gutter, no bubbles). Right: a 320px graphite instrument column (L-1 inside an L1 plate): Pays with (Budget / My wallet), Network (only quoting ones), today's meter ("$0.00 of $1.00 today", rails + ball), Autopay, last 5 settlements. A quote is a faceplate strip: maker logo, tool, wide price, network, lamp verdict, Decline / "Approve and pay $0.045"; it turns in place into Settled + tx link, "Declined. Nothing was signed." or "No result, no charge. Nothing was settled." Inline states keep the request: no payer (create a Budget or connect a wallet), insufficient funds (deposit address + Copy), over cap (confirm raising it for this payment). Empty state: "What should your agent get done?" + six example briefs as rows (tool + catalog price) beside the S engraved into a small faceplate with the ball at rest. `?q=` no longer auto-sends. Phone: one column, a one-line cap strip opens the instrument sheet, composer sticks above the keyboard.
- **Budget** (`/budget`): a numbered setup sheet on a faceplate, not a card dashboard. 1 Key: create/import with honest text "Your key is made on this device and kept in this browser's storage, unencrypted. Export a backup. The CLI encrypts its key with your password." 2 Caps: knob 03 as the daily-cap control + fields per call / per swap + an Autopay switch with its consequence written. 3 Fund: a table of the 5 networks (asset, address + Copy, live balance, "unreadable · Retry"), render 05 small with the caption "The top plate is the default: USDG on Robinhood Chain." 4 Use: Ask, CLI, MCP. Once a wallet exists: a sticky index (Caps, Funds, Spend, Move, Key, Code), the key zone last with a confirm dialog.
- **Tools** (`/tools`): a graphite price ruler on top (one tick per tool, the cap line at the saved or default cap), then a dense table as the main view: logo + tool, maker, category, price per call (wide, tabular, right), time ("seconds" / "minutes" from the slow flag), live lamp + word, endpoint mono from 1100px; `aria-sort`, category filter with real counts, `?c ?q ?sort` in the URL; phones get two-line rows. `/tools/:id` is a spec sheet: wide price + "Get live quote" (unpaid 402), input table, Returns, curl / CLI / MCP + Copy, a sticky graphite Run deck (the cap check disables the pay key and writes why before any click), receipt strip + result.
- **Activity** (`/activity`): a full graphite page because the content is live. One sentence from `/api/stats` (no KPI tiles), a 30-day strip with a text summary for screen readers, a table: UTC time, tool, network, short payer, USD, ms, tx link. Filters network/tool + payer search (`/v1/payments?payer=`). Polls every 20 s only while the tab is visible. Empty (today): "No settlements yet. The first paid call appears here with its transaction hash." + Ask Siro / Pick a tool; loading "Reading the settlements table"; error + Retry.
- **Docs**: three panels (sticky index, a 64ch reading column on the bench, a graphite live panel on the right that runs something real for the visible section, e.g. "Send unpaid request"); code blocks are labelled recessed displays + Copy; "Errors and refunds" becomes "Errors and charges" (there are no refunds; failed calls are never settled); old anchors kept.
- **Shipped**: a table of what is live with dates from real deploys (10 Nov Solana payments live; 14 Nov siroagent.com + MCP Registry listing) and a "Next" table without invented dates (Sell a tool: Soon; streaming, more networks, chained tool calls, team budgets: Later).
- **404**: "This page is off the route." + the S engraved into an aluminium faceplate + Search + Ask Siro.

## Assets

01 hero render: home "Two rails" only (no render in the hero). 02 route-top: 404 + Ask empty state. 03 knob: home cap section + Budget. 04 tile grid: only Docs discovery. 05 plate stack: only Budget Fund step. 06 macro: home "No result, no charge". The flat S: rail, search, footer, favicon. Renders are re-baked to their new surfaces with `tools/bake-images.sh` and displayed no larger than their source (01 ≤ 900px, 06 ≤ 1200px).

## Honesty rules

Numbers only from `/api/stats`, `/api/ledger`, `/v1/resources`, a real 402, or `shared/catalog.ts`, each with source and time; "none yet" when empty. No em dashes in any copy. The browser wallet key is unencrypted localStorage: never call it encrypted. No KPI tiles, logo strips, token sections or testimonials.
