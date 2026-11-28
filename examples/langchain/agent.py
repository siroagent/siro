"""LangChain agent that pays for its tools from the local Siro wallet."""

import asyncio
import os

from langchain.agents import create_agent
from langchain_mcp_adapters.client import MultiServerMCPClient

SYSTEM = (
    "You pay for tools with a Siro wallet. Use siro_call with resource gas-now for chain data, "
    "and siro_call with resource llm-auto (tier fast) for writing. "
    "Report the cost and the transaction hash of each paid call."
)


async def main() -> None:
    password = os.environ.get("SIRO_PASSWORD")
    if not password:
        raise SystemExit("Export SIRO_PASSWORD first (see ../README.md).")
    # The MCP process gets only these variables, so pass SIRO_HOME on when the wallet lives elsewhere.
    env = {"SIRO_PASSWORD": password, **({"SIRO_HOME": os.environ["SIRO_HOME"]} if "SIRO_HOME" in os.environ else {})}

    client = MultiServerMCPClient(
        {"siro": {"transport": "stdio", "command": "siro", "args": ["mcp"], "env": env}}
    )
    tools = await client.get_tools()
    agent = create_agent(f"openai:{os.environ.get('MODEL', 'gpt-5-mini')}", tools, system_prompt=SYSTEM)
    out = await agent.ainvoke(
        {"messages": [{"role": "user", "content": "What is the gas price on Robinhood Chain right now? Summarise it in one line."}]}
    )
    print(out["messages"][-1].content)


if __name__ == "__main__":
    asyncio.run(main())
