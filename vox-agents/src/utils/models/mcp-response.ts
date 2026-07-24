/**
 * @module utils/models/mcp-response
 *
 * Normalizes MCP tool results while retaining text-only protocol errors.
 */

/** The normalized fields needed by callers that consume MCP tool responses. */
export interface McpResponseView {
  data: Record<string, unknown>;
  text?: string;
  hasStructuredContent: boolean;
}

/** Return whether a value can be read as a string-keyed object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unwrap structured content and preserve the first text content item for error reporting. */
export function unwrapMcpResponse(result: unknown): McpResponseView {
  const raw = isRecord(result) ? result : {};
  const structured = isRecord(raw.structuredContent) ? raw.structuredContent : undefined;
  const content = Array.isArray(raw.content) ? raw.content : [];
  const textItem = content.find((item) => isRecord(item) && typeof item.text === "string");
  return {
    data: structured ?? raw,
    ...(isRecord(textItem) ? { text: textItem.text as string } : {}),
    hasStructuredContent: structured !== undefined,
  };
}
