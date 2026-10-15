import { describe, it, expect } from "vitest";
import { mcpClient } from "../../../setup.js";

describe("Lua executor results through MCP", () => {

  it("passes controlled bridge script results to callers", async () => {
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

      const content = (result.content as any)[0];
      expect(content.type).toBe("text");
      expect(JSON.parse(content.text).Result).toBe(test.expected);
    }
  });

  it("passes a controlled bridge script failure to callers", async () => {
    const result = await mcpClient.callTool({
      name: "lua-executor",
      arguments: { Script: "invalid lua code @#$" }
    });

    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    const parsed = JSON.parse(content.text);
    expect(parsed.Success).toBe(false);
    expect(parsed.Error).toMatchObject({
      Code: 'SCRIPT_ERROR',
      Message: 'script is not included in the deterministic test fixture',
    });
  });
});
