import { describe, it, expect } from "vitest";
import { mcpClient } from "../../../setup.js";

describe("Lua Executor Tool via MCP", () => {

  it("should list lua-executor tool", async () => {
    const tools = await mcpClient.listTools();
    
    expect(tools.tools).toBeDefined();
    expect(tools.tools.length).toBeGreaterThan(0);
    
    const luaExecutorTool = tools.tools.find(t => t.name === "lua-executor");
    expect(luaExecutorTool).toBeDefined();
    expect(luaExecutorTool?.description).toContain("Lua");
    expect(luaExecutorTool?.inputSchema).toBeDefined();
  });

  it("should execute basic Lua calculations", async () => {
    const testCases = [
      { Script: "return 2 + 3", expected: 5 },
      { Script: "return 10 * 5", expected: 50 },
      { Script: "return math.sqrt(16)", expected: 4 },
      { Script: "return 2^8", expected: 256 },
      { Script: "return (10 + 5) * 2", expected: 30 }
    ];

    for (const test of testCases) {
      const result = await mcpClient.callTool({
        name: "lua-executor",
        arguments: { Script: test.Script }
      });

      expect(result.content).toBeDefined();
      expect((result.content as any)).toBeDefined();
      
      const content = (result.content as any);
      if (content.type === "text") {
        const parsed = JSON.parse(content.text);
        expect(parsed.Result).toBe(test.expected);
      }
    }
  });

  it("should handle errors gracefully", async () => {
    const result = await mcpClient.callTool({
      name: "lua-executor",
      arguments: { Script: "invalid lua code @#$" }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      // Should contain error message
      const parsed = JSON.parse(content.text);
      expect(parsed.Error || parsed.Success === false).toBeTruthy();
    }
  });
});