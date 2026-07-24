/**
 * @module utils/models/mcp-response
 *
 * Normalizes MCP tool results at one boundary: a structured success returns its
 * structuredContent, anything else (isError envelope, missing structured payload)
 * throws. Callers therefore never have to remember to check for error envelopes —
 * forgetting cannot silently read as an empty success.
 */

/** Return whether a value can be read as a string-keyed object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Unwrap a structured MCP tool result or throw with the tool's text explanation.
 *
 * NOTE: tools whose results are legitimately unstructured or whose error envelopes
 * must pass through as data (LLM-facing tool wrappers) cannot use this — see
 * `normalizeMCPToolResult` in utils/tools/mcp-tools.ts.
 *
 * @param result - The raw CallToolResult envelope from `mcpClient.callTool`
 * @param context - Tool name (or call description) used in the thrown error message
 */
export function unwrapMcpResponse(result: unknown, context: string): Record<string, unknown> {
  const raw = isRecord(result) ? result : {};
  const structured = isRecord(raw.structuredContent) ? raw.structuredContent : undefined;
  if (raw.isError === true || structured === undefined) {
    const content = Array.isArray(raw.content) ? raw.content : [];
    const textItem = content.find((item) => isRecord(item) && typeof item.text === "string");
    const text = isRecord(textItem) ? (textItem.text as string) : "no structured result returned";
    throw new Error(`${context} failed: ${text}`);
  }
  return structured;
}
