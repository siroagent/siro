"""OpenAI Agents SDK agent that pays for its tools from the local Siro wallet."""

import asyncio
import os

from agents import Agent, Runner
from agents.mcp import MCPServerStdio

INSTRUCTIONS = (
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

    async with MCPServerStdio(
        name="siro",
        params={"command": "siro", "args": ["mcp"], "env": env},
        client_session_timeout_seconds=60,
    ) as siro:
        agent = Agent(
            name="Siro agent",
            instructions=INSTRUCTIONS,
            model=os.environ.get("MODEL", "gpt-5-mini"),
            mcp_servers=[siro],
        )
        result = await Runner.run(agent, "What is the gas price on Robinhood Chain right now? Summarise it in one line.")
        print(result.final_output)


if __name__ == "__main__":
    asyncio.run(main())
