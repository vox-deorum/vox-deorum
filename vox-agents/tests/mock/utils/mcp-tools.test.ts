import { describe, expect, it } from "vitest";
import { normalizeMCPToolResult } from "../../../src/utils/tools/mcp-tools.js";

describe("normalizeMCPToolResult", () => {
  it("unwraps primitive boolean text results", () => {
    expect(normalizeMCPToolResult({
      content: [{ type: "text", text: "true" }]
    })).toBe(true);

    expect(normalizeMCPToolResult({
      content: [{ type: "text", text: "false" }]
    })).toBe(false);
  });

  it("unwraps primitive string text results", () => {
    expect(normalizeMCPToolResult({
      content: [{ type: "text", text: "deliberation-total" }]
    })).toBe("deliberation-total");
  });

  it("prefers structured content for object results", () => {
    const structured = { PlayerID: 7, Turn: 4 };

    expect(normalizeMCPToolResult({
      content: [{ type: "text", text: JSON.stringify(structured) }],
      structuredContent: structured
    })).toEqual(structured);
  });

  it("unwraps legacy Result envelopes after MCP normalization", () => {
    expect(normalizeMCPToolResult({
      structuredContent: { Result: { Success: true } }
    })).toEqual({ Success: true });
  });

  it("keeps MCP error wrappers intact", () => {
    const errorResult = {
      isError: true,
      content: [{ type: "text", text: "Error executing tool" }]
    };

    expect(normalizeMCPToolResult(errorResult)).toBe(errorResult);
  });
});
