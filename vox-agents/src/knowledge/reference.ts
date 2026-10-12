/**
 * @module knowledge/reference
 *
 * Writes the game reference into each file-enabled seat's workspace store: the technology, policy,
 * building, and unit listings from the game database, as Markdown and JSON under `reference/`. Each
 * seat mounts it read-only, and its commits keep it next to the records, so a recorded version
 * holds everything the seat's bash workspace showed.
 */

import { mcpClient } from "../utils/models/mcp-client.js";
import { unwrapMcpResponse } from "../utils/models/mcp-response.js";
import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";
import { isRecord } from "../utils/guards.js";
import { createLogger } from "../utils/logger.js";
import { referenceStorePrefix, type PathChange, type WorkspaceStore } from "../utils/workspace/workspace-store.js";

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

/** Whether a store's head holds any game reference file. */
export function hasGameReference(store: WorkspaceStore): boolean {
  for (const storePath of store.manifest().keys()) {
    if (storePath.startsWith(referenceStorePrefix)) return true;
  }
  return false;
}

/**
 * Write the game reference into every store whose head lacks it, as one `reference` commit each.
 * All four listings are fetched, once, before any store is written, and only when some store needs
 * them.
 *
 * @param stores - The file-enabled seats' stores
 * @returns how many stores received the reference
 * @throws on any fetch, result, or commit failure; a failed fetch writes nothing
 */
export async function writeGameReference(stores: WorkspaceStore[]): Promise<number> {
  const missing = stores.filter((store) => !hasGameReference(store));
  if (missing.length === 0) return 0;

  const changes: PathChange[] = [];
  for (const { tool, file, title } of referenceTools) {
    const items = await fetchItems(tool);
    changes.push(
      { path: `${referenceStorePrefix}${file}.md`, type: "file", content: renderItems(title, items) },
      { path: `${referenceStorePrefix}${file}.json`, type: "file", content: JSON.stringify(items, null, 2) },
    );
  }
  for (const store of missing) {
    store.commit({ kind: "reference", turn: null, author: "host", changes });
  }
  logger.info(`Wrote the game reference into ${missing.length} seat store(s)`);
  return missing.length;
}
