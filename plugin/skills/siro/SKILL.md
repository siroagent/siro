---
name: siro
description: Pay per call for AI and data with the Siro x402 wallet. Use when the user wants something a Siro tool or another x402 service provides (language models, including the cheapest model that fits a task; image, video, music and speech models; web reading and translation; gas, balances, new pools and contract reads on Robinhood Chain or Base; tokenized stock prices and signals; Polymarket prediction markets), asks to pay an x402 URL, asks what the agent wallet holds or spent, or asks to set up Siro.
---

# Siro

Siro is an x402 wallet for agents. It pays per call in USDG on Robinhood Chain, or in USDC on Base, Solana, Arbitrum or Polygon. The key and the spending caps stay on the user's machine, and every paid call returns a receipt with a transaction hash.

## The two MCP servers

- `siro-catalog` is remote (https://siroagent.com/mcp) and needs no setup. Use it to list tools, read an input schema and search third-party x402 services. It does not pay.
- `siro` is the local wallet (`siro mcp` from the Siro CLI). It pays, but only within the caps the user set. If it is not connected, the wallet is not set up yet: follow **Setup**.

## Flow

1. Find the tool with `siro_resources` (pass `query`, e.g. "stock", "image", "polymarket"). If nothing in Siro's catalog fits, search other x402 services with `siro_discover`.
2. Read its input with `siro_resource_schema` on `siro-catalog`. Bad input is refused before any payment.
3. Run it with `siro_call` on the local `siro` server, or with `siro_pay` for a third-party x402 URL from `siro_discover`.
4. Tell the user what it cost and give them the transaction hash from the receipt.

For text, prefer the `llm-auto` tool: give it `prompt`, a `tier` (`fast`, `balanced` or `frontier`) and, if useful, a `max_price`. Siro picks the cheapest model that fits and names it in the price quote. Checks such as `must_include`, `min_chars` or `json_keys` make Siro retry on the next model at its own cost when an answer fails them.

## Money rules

- Never ask the user for the wallet password and never put it in a command, a file or the chat. The local server reads it from the `SIRO_PASSWORD` environment variable, which the user sets themselves.
- Do not raise caps (`siro limits`), turn on MCP swaps or run `siro_swap` unless the user asked for that in their own words.
- Say the price before a call above $0.05, and stop if the user has not asked for that tool.
- A failed call is not charged. If a call fails, report the error; do not retry it in a loop.

## Setup

The user runs these in their own terminal, because `init` asks for a password:

```bash
npm i -g https://siroagent.com/cli/siro.tgz
siro init
siro limits --per-payment 0.1 --per-day 1
siro address
```

Then they send a few dollars of USDG (Robinhood Chain) or USDC (Base, Solana, Arbitrum, Polygon) to the address `siro address` prints, and export `SIRO_PASSWORD` in the shell that starts the agent. `siro balance` shows what arrived.

## If the servers are missing

Installed as a skill only (`npx skills add siroagent/siro`, or read from https://siroagent.com/skill.md), the servers are not configured. Ask the user before changing their MCP config, then add them:

- Claude Code: `claude mcp add --transport http siro-catalog https://siroagent.com/mcp`, then `claude mcp add siro -- siro mcp`
- Codex: `codex mcp add siro-catalog --url https://siroagent.com/mcp`, then `codex mcp add siro -- siro mcp`, and add `env_vars = ["SIRO_PASSWORD"]` under `[mcp_servers.siro]` in `~/.codex/config.toml` so the variable is passed through
- Cursor or another client: `{"mcpServers":{"siro-catalog":{"url":"https://siroagent.com/mcp"},"siro":{"command":"siro","args":["mcp"],"env":{"SIRO_PASSWORD":"${env:SIRO_PASSWORD}"}}}}`

In every case `SIRO_PASSWORD` comes from the environment the client starts in. Never write the password itself into a config file.

Without any server, `npx -y --package=https://siroagent.com/cli/siroagent-0.1.3.tgz siro resources <words>` still lists tools and prices, with no wallet.

## $SIRO holders

A wallet holding 1,000,000 $SIRO on Robinhood Chain is quoted 25% less on every Siro tool, and 10,000,000 gives 50%. Holders also get free daily runs of Siro's seven data tools. `siro_holder` shows what applies. Payments stay in USDG or USDC; $SIRO is never spent.

Docs: https://siroagent.com/docs
