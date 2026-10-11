/**
 * @module knowledge/reference
 *
 * Writes a game's reference folder once per game: the technology, policy, building, and unit
 * listings from the game database, as Markdown and JSON. Every file-enabled seat of the game mounts
 * the folder read-only. The files are written into a temporary folder and renamed into place, so an
 * existing folder always holds a complete write.
 */

import fs from "node:fs";
import path from "node:path";
import { mcpClient } from "../utils/models/mcp-client.js";
import { unwrapMcpResponse } from "../utils/models/mcp-response.js";
import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";
import { isRecord } from "../utils/guards.js";
import { createLogger } from "../utils/logger.js";
import { workspaceReferencePath } from "../utils/workspace/player-workspace.js";

const logger = createLogger('GameReference');

/** The database tools the reference lists, with the file name and title of each. */
const referenceTools = [
  { tool: "get-technology", file: "technologies", title: "Technologies" },
  { tool: "get-policy", file: "policies", title: "Policies" },
  { tool: "get-building", file: "buildings", title: "Buildings" },
  { tool: "get-unit", file: "units", title: "Units" },
] as const;

/** Upper bound on listing rows, large enough to return every row of each table. */
const referenceMaxResults = 5000;

/**
 * Fetch one database tool's items. A query that resolves to one item returns a detailed report
 * instead of a listing row, so items are treated as plain records of any shape.
 *
 * @throws on an MCP error, an `Error` field in the result, or a result without an item list
 */
async function fetchItems(tool: string): Promise<Record<string, unknown>[]> {
  const result = unwrapMcpResponse(await mcpClient.callTool(tool, { MaxResults: referenceMaxResults }), tool);
  if (result.Error) throw new Error(`${tool} failed: ${String(result.Error)}`);
  if (!Array.isArray(result.Items)) throw new Error(`${tool} returned no item list.`);
  return result.Items.filter(isRecord);
}

/**
 * Render items as Markdown, one heading per item named after it. Duplicate names get the item's
 * type appended so no item hides another.
 */
function renderItems(title: string, items: Record<string, unknown>[]): string {
  const byName: Record<string, unknown> = {};
  items.forEach((item, index) => {
    const { Name, ...rest } = item;
    let key = String(Name ?? item.Type ?? `Item ${index + 1}`);
    if (key in byName) key = `${key} (${String(item.Type ?? index + 1)})`;
    byName[key] = rest;
  });
  const body = jsonToMarkdown(byName, { configs: [{ format: "{key}" }], startingLevel: 2 });
  return `# ${title}\n\n${body}\n`;
}

/**
 * Write the game reference unless it already exists. All four listings are fetched before any file
 * is written, and the folder appears only through the final rename.
 *
 * @param gameID - The game the reference belongs to
 * @returns true when the reference was written, false when an earlier session already wrote it
 * @throws on any fetch, result, or write failure; a partial temporary folder is removed
 */
export async function writeGameReference(gameID: string): Promise<boolean> {
  const target = workspaceReferencePath(gameID);
  if (fs.existsSync(target)) return false;

  const listings = [];
  for (const entry of referenceTools) {
    listings.push({ ...entry, items: await fetchItems(entry.tool) });
  }

  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.mkdirSync(temp, { recursive: true });
    for (const { file, title, items } of listings) {
      fs.writeFileSync(path.join(temp, `${file}.md`), renderItems(title, items));
      fs.writeFileSync(path.join(temp, `${file}.json`), JSON.stringify(items, null, 2));
    }
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    // Another session of the same game finished its write first.
    if (fs.existsSync(target)) return false;
    throw error;
  }
  logger.info(`Wrote the game reference for ${gameID}`, { path: target });
  return true;
}
