/**
 * @module utils/mcp
 * @description MCP (Model Context Protocol) utility functions for formatting responses
 *
 * Provides helper functions to convert various data types into the standardized
 * MCP CallToolResult format, which requires a content array with typed content items.
 *
 * @example
 * ```typescript
 * import { wrapResults } from './utils/mcp.js';
 *
 * // String result
 * const result1 = wrapResults("Hello");
 * // { content: [{ type: "text", text: "Hello" }] }
 *
 * // Object result
 * const result2 = wrapResults({ key: "value" });
 * // { content: [{ type: "text", text: "{\n  \"key\": \"value\"\n}" }], structuredContent: {...} }
 * ```
 */

import { CallToolResult } from "@modelcontextprotocol/sdk/types";

/**
 * Wraps tool execution results into the proper MCP CallToolResult format
 *
 * Converts various data types (string, number, boolean, array, object) into the
 * standardized MCP CallToolResult format. The function intelligently handles:
 * - Already formatted CallToolResult objects (pass-through)
 * - Primitive types (string, number, boolean)
 * - Arrays (recursively wraps each element)
 * - Objects (serializes to JSON with structured content)
 * - Null/undefined values (returns success message)
 *
 * @param result - The raw result from tool execution (can be any type)
 * @returns A properly formatted CallToolResult with content array
 *
 * @example
 * ```typescript
 * // String result
 * wrapResults("Success");
 * // Returns: { content: [{ type: "text", text: "Success" }] }
 *
 * // Object result with structured content
 * wrapResults({ players: 8, turn: 150 });
 * // Returns: {
 * //   content: [{ type: "text", text: "{\n  \"players\": 8,\n  \"turn\": 150\n}" }],
 * //   structuredContent: { players: 8, turn: 150 }
 * // }
 *
 * // Array result
 * wrapResults([1, 2, 3]);
 * // Recursively wraps each element
 * ```
 */
export function wrapResults(result: unknown): CallToolResult {
  // If result is already in CallToolResult format, return as-is
  if (result && typeof result === 'object' && 'content' in result && Array.isArray(result.content)) {
    return result as CallToolResult;
  }

  // Handle null/undefined results
  if (result === null || result === undefined) {
    return {
      content: [
        {
          type: "text",
          text: "Tool execution completed successfully with no output"
        }
      ]
    };
  }

  // Handle string results
  if (typeof result === 'string') {
    return {
      content: [
        {
          type: "text",
          text: result
        }
      ]
    };
  }

  // Handle primitive types (number, boolean)
  if (typeof result === 'number' || typeof result === 'boolean') {
    return {
      content: [
        {
          type: "text",
          text: String(result)
        }
      ]
    };
  }

  // Handle arrays - call recursively on each element. The MCP spec requires
  // `structuredContent` to be a record, so a root-level array is omitted from it
  // (a non-conforming array there fails client-side validation and, for the
  // strategist, kills the game process). Tools that need structured output should
  // wrap their list in an object, e.g. `{ messages: [...] }`.
  if (Array.isArray(result)) {
    return {
      content: result.flatMap(item => wrapResults(item).content)
    };
  } else if (typeof result === 'object') {
    // Handle objects - serialize to JSON
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      structuredContent: result as any
    };
  }

  // Fallback for any other type
  return {
    content: [
      {
        type: "text",
        text: String(result)
      }
    ]
  };
}