# Changelog

Dates are UTC.

## 2026-11-28

- Agent plugin for Claude Code, Cursor and Codex (`plugin/`): the remote catalog, the local wallet over `siro mcp` and a skill with the money rules. The skill is also at `/skill.md` and installs with `npx skills add siroagent/siro`.
- `examples/`: Vercel AI SDK, LangChain and OpenAI Agents SDK agents that pay for `gas-now` and `llm-auto` through the local wallet.
- `/openapi.json`: every live tool as an OpenAPI 3.1 operation with its x402 price, generated from the catalog.
- MCP `siro_discover` now says it searches tools sold on Siro and featured partners before the Bazaar.
- Featured partners in discovery: partner x402 services come right after tools sold on Siro when a search matches, each shown only while its own 402 is live and payable. First partner: ApexFaucet's Robinhood Chain launch feed with a real sell test.

## 2026-11-27

- Cheapest Model (`/v1/llm-auto`): Siro picks the cheapest language model that fits a tier, a maker and a price ceiling, and names it in the 402 quote.
- Checks for Cheapest Model: `must_include`, `min_chars`, `json`, `json_keys`. A failed answer is retried on the next model up, at most twice, at Siro's cost; if none passes, the call fails and nothing is settled.
- $SIRO holder pricing: 25% off every tool from 1,000,000 $SIRO, 50% from 10,000,000, quoted in the 402 for the paying address (`x-siro-holder`). Free daily runs of the seven data tools with a signed holder pass (`x-siro-pass`). `GET /api/holder/<address>`.
- CLI 0.1.3: `siro holder`, holder price and free runs in `siro call`, `siro_holder` in the local MCP server.
- Wallet picker on the site: every installed browser wallet is listed and the visitor chooses.
- Private results: media links expire, and a payer can delete a result with a signed request.

## 2026-11-26

- Result receipts: every paid call stores the sha256, size and kind of its result; the receipt carries `resultSha256`. `/api/proofs` shows the full results of calls paid by Siro's own wallets.
- `/api/ledger` returns totals for the whole table and takes `?limit=` up to 500.

## 2026-11-25

- $SIRO launched on Robinhood Chain; the official contract is shown on the site.

## 2026-11-16

- All 67 tools settled on Base and listed in the x402 Bazaar.
- Sell a tool: list an HTTPS API and get paid directly over x402.
