import { describe, it, expect } from "vitest";
import { mcpClient } from "../../../setup.js";

describe("Calculator Tool via MCP", () => {

  it("should list calculator tool", async () => {
    const tools = await mcpClient.listTools();
    
    expect(tools.tools).toBeDefined();
    expect(tools.tools.length).toBeGreaterThan(0);
    
    const calculatorTool = tools.tools.find(t => t.name === "calculator");
    expect(calculatorTool).toBeDefined();
    expect(calculatorTool?.description).toContain("mathematical");
    expect(calculatorTool?.inputSchema).toBeDefined();
  });

  it("should execute basic calculations", async () => {
    const testCases = [
      { Expression: "2 + 3", expected: 5 },
      { Expression: "10 * 5", expected: 50 },
      { Expression: "sqrt(16)", expected: 4 },
      { Expression: "2^8", expected: 256 },
      { Expression: "(10 + 5) * 2", expected: 30 }
    ];

    for (const test of testCases) {
      const result = await mcpClient.callTool({
        name: "calculator",
        arguments: { Expression: test.Expression }
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

  it("should handle complex expressions", async () => {
    const result = await mcpClient.callTool({
      name: "calculator",
      arguments: { Expression: "pi * 2" }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any);
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      expect(parsed.Result).toBeCloseTo(6.283185307);
    }
  });

  it("should handle non-numeric results", async () => {
    const result = await mcpClient.callTool({
      name: "calculator",
      arguments: { Expression: "sqrt(-1)" }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    if (content.type === "text") {
      const parsed = JSON.parse(content.text);
      expect(parsed.Result).toBe("i");
    }
  });

  it("should handle errors gracefully", async () => {
    const result = await mcpClient.callTool({
      name: "calculator",
      arguments: { Expression: "invalid expression @#$" }
    });

    expect(result.content).toBeDefined();
    const content = (result.content as any)[0];
    expect(content.type).toBe("text");
    
    if (content.type === "text") {
      // Should contain error message
      expect(content.text).toContain("error");
    }
  });
});