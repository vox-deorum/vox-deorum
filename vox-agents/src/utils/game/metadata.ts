/**
 * @module utils/game/metadata
 *
 * Thin wrappers around the MCP `set-metadata` / `get-metadata` tool calls used
 * throughout the strategist pipeline to record per-game audit data
 * (configured seeds, seating cycle coordinates, experiment names, etc.).
 *
 * These wrappers exist to keep the strategist (and any future) call sites
 * focused on *what* they're recording rather than the MCP plumbing. They do
 * **not** flow through `VoxContext.callTool` — that path is reserved for
 * per-player telemetry capture. Use these helpers for session-level metadata
 * that should be written once per game regardless of which player is active.
 */

import { mcpClient } from '../models/mcp-client.js';

/**
 * Read a metadata value previously written by Civ V (via the DLL) or by an
 * earlier `setMetadata` call. Returns an empty string when the key is absent
 * or the response shape is unexpected — callers that need to distinguish
 * missing from empty must check the length themselves.
 */
export async function getMetadata(key: string): Promise<string> {
  const result = await mcpClient.callTool('get-metadata', { Key: key }) as Record<string, unknown>;
  const content = result.content as Array<{ type: string; text: string }> | undefined;
  return content?.[0]?.text ?? '';
}

/**
 * Write a metadata value. Numbers are stringified — MCP stores all metadata
 * as text and the strategist's set-metadata sites all wrap numeric values in
 * `String(...)` today.
 */
export async function setMetadata(key: string, value: string | number): Promise<void> {
  await mcpClient.callTool('set-metadata', { Key: key, Value: String(value) });
}
