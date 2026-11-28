// Vercel AI SDK agent that pays for its tools from the local Siro wallet.
import { openai } from "@ai-sdk/openai";
import { experimental_createMCPClient as createMCPClient } from "@ai-sdk/mcp";
import { StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { generateText, isStepCount } from "ai";

const password = process.env.SIRO_PASSWORD;
if (!password) throw new Error("Export SIRO_PASSWORD first (see ../README.md).");

// The MCP process gets only these variables, so pass SIRO_HOME on when the wallet lives elsewhere.
const env: Record<string, string> = { SIRO_PASSWORD: password };
if (process.env.SIRO_HOME) env.SIRO_HOME = process.env.SIRO_HOME;
const siro = await createMCPClient({ transport: new StdioMCPTransport({ command: "siro", args: ["mcp"], env }) });

try {
  const result = await generateText({
    model: openai(process.env.MODEL ?? "gpt-5-mini"),
    tools: await siro.tools(),
    stopWhen: isStepCount(8),
    system:
      "You pay for tools with a Siro wallet. Use siro_call with resource gas-now for chain data, and siro_call with resource llm-auto (tier fast) for writing. Report the cost and the transaction hash of each paid call.",
    prompt: "What is the gas price on Robinhood Chain right now? Summarise it in one line.",
  });
  console.log(result.text);
} finally {
  await siro.close();
}
