import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const CLI = json("cli/package.json").version as string;

describe("agent plugin", () => {
  it("serves the same skill at /skill.md", () => {
    expect(readFileSync("public/skill.md", "utf8")).toBe(readFileSync("plugin/skills/siro/SKILL.md", "utf8"));
  });

  it("keeps one plugin version across Claude Code, Cursor, Codex and the marketplace", () => {
    const v = json("plugin/.claude-plugin/plugin.json").version;
    expect(json("plugin/.cursor-plugin/plugin.json").version).toBe(v);
    expect(json("plugin/.codex-plugin/plugin.json").version).toBe(v);
    expect(json(".claude-plugin/marketplace.json").plugins[0].version).toBe(v);
  });

  it("points the wallet server at the current CLI package and the catalog at /mcp", () => {
    for (const p of ["plugin/.mcp.json", "plugin/cursor/mcp.json"]) {
      const s = json(p).mcpServers;
      expect(s["siro-catalog"].url).toBe("https://siroagent.com/mcp");
      expect(s.siro.args).toContain(`--package=https://siroagent.com/cli/siroagent-${CLI}.tgz`);
      expect(JSON.stringify(s.siro.env)).toMatch(/\$\{(env:)?SIRO_PASSWORD\}/);
    }
    expect(readFileSync("plugin/skills/siro/SKILL.md", "utf8")).toContain(`siroagent-${CLI}.tgz`);
  });
});
