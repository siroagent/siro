# Examples

Each example gives an agent framework the local Siro wallet as an MCP server (`siro mcp`) and asks one question that needs two paid tools:

1. `gas-now` ($0.001): the current gas price on Robinhood Chain.
2. `llm-auto` (from $0.002): Siro picks the cheapest fast model and writes the one-line summary.

A run costs well under one cent. The wallet signs each payment only inside the caps you set with `siro limits`, and a failed call is not charged.

| Folder | Framework | Language |
|---|---|---|
| [vercel-ai-sdk](vercel-ai-sdk/) | Vercel AI SDK 7 with `@ai-sdk/mcp` | TypeScript |
| [langchain](langchain/) | LangChain 1.x with `langchain-mcp-adapters` | Python |
| [openai-agents](openai-agents/) | OpenAI Agents SDK | Python |

## Before any of them

```bash
npm i -g https://siroagent.com/cli/siro.tgz
siro init                                   # asks for a password
siro limits --per-payment 0.05 --per-day 0.5
siro address                                # fund with $1 of USDG on Robinhood Chain or USDC on Base
export SIRO_PASSWORD='the password you chose'
```

The examples drive the agent with an OpenAI model, so they also need `OPENAI_API_KEY`. Any model the framework supports works; only the agent's own model changes.

The password is read from the environment and passed to the `siro mcp` process only. Keep it out of code and out of `.env` files you commit.
