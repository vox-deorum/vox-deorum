/**
 * @module knowledge/reference
 *
 * Writes the game reference into each file-enabled seat's workspace store: the technologies,
 * policies, buildings, and units of the game database with their full details and the game's own
 * tooltips, trimmed and in game order, as Markdown and JSON under `reference/`. Each seat mounts it
 * read-only, and its commits keep it next to the records, so a recorded version holds everything
 * the seat's bash workspace showed.
 */

import { mcpClient } from "../utils/models/mcp-client.js";
import { unwrapMcpResponse } from "../utils/models/mcp-response.js";
import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";
import { isRecord } from "../utils/guards.js";
import { createLogger } from "../utils/logger.js";
import { referenceStorePrefix, type PathChange, type WorkspaceStore } from "../utils/workspace/workspace-store.js";

const logger = createLogger('GameReference');

type Item = Record<string, unknown>;

/** Sort key for one listing: units, buildings, and technologies by era then cost; policies by era, branch, then level. */
type SortKey = (item: Item) => (string | number)[];

/** Era, then cost, the order the game unlocks most entries in. */
const byEraAndCost: SortKey = (item) => [eraRank(item.Era), numberOf(item.Cost)];

/** The database tools the reference lists, with the file name, title, and order of each. */
const referenceTools: { tool: string; file: string; title: string; sortKey: SortKey }[] = [
  { tool: "get-technology", file: "technologies", title: "Technologies", sortKey: byEraAndCost },
  { tool: "get-policy", file: "policies", title: "Policies", sortKey: (item) => [eraRank(item.Era), String(item.Branch ?? ""), numberOf(item.Level)] },
  { tool: "get-building", file: "buildings", title: "Buildings", sortKey: byEraAndCost },
  { tool: "get-unit", file: "units", title: "Units", sortKey: byEraAndCost },
];

/** Upper bound on listing rows, large enough to return every row of each table. */
const referenceMaxResults = 5000;

/** Era names in game order, as the database tools report them. */
const eraOrder = ["Ancient", "Classical", "Medieval", "Renaissance", "Industrial", "Modern", "Atomic", "Information"];

/** Fields whose zero means "none" and is dropped. */
const zeroMeansNone = new Set(["Combat", "RangedCombat", "Range", "Maintenance", "Happiness", "Defense", "HP"]);

/** Fields left out of the reference: AI internals and advice prose the tooltip supersedes. */
const omittedFields = new Set(["AIType", "Strategy", "Description"]);

/** Rank an era for sorting; entries without an era (starting units) come first. */
function eraRank(era: unknown): number {
  if (typeof era !== "string") return -1;
  const index = eraOrder.indexOf(era);
  return index === -1 ? eraOrder.length : index;
}

/** A sortable number, with anything else as zero. */
function numberOf(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/**
 * Drop empty values with the same rules as the MCP server's `cleanEventData`: null, empty
 * strings, false, -1, "None", and empty arrays or objects. Zero is dropped only for the fields
 * where it means none, and omitted fields are removed.
 */
function trimValue(value: unknown, key?: string): unknown {
  if (value === null || value === undefined || value === "" || value === false || value === -1 || value === "None") return undefined;
  if (value === 0 && key !== undefined && zeroMeansNone.has(key)) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const items = value.map((entry) => trimValue(entry)).filter((entry) => entry !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([field]) => !omittedFields.has(field))
      .map(([field, entry]) => [field, trimValue(entry, field)] as const)
      .filter(([, entry]) => entry !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

/**
 * Fetch one database tool's full reports, trimmed and sorted by the listing's key and then by name.
 * The unit tool already leaves out barbarian-only units.
 *
 * @throws on an MCP error, an `Error` field in the result, or a result without an item list
 */
async function fetchItems(tool: string, sortKey: SortKey): Promise<Item[]> {
  const result = unwrapMcpResponse(await mcpClient.callTool(tool, { MaxResults: referenceMaxResults, Detailed: true }), tool);
  if (result.Error) throw new Error(`${tool} failed: ${String(result.Error)}`);
  if (!Array.isArray(result.Items)) throw new Error(`${tool} returned no item list.`);
  const items = result.Items
    .map((item) => trimValue(item))
    .filter((item): item is Item => isRecord(item));
  const keyed = items.map((item) => ({ item, key: [...sortKey(item), String(item.Name ?? "")] }));
  keyed.sort((a, b) => compareKeys(a.key, b.key));
  return keyed.map(({ item }) => item);
}

/** Compare two sort keys field by field. */
function compareKeys(a: (string | number)[], b: (string | number)[]): number {
  for (let index = 0; index < a.length; index++) {
    const [left, right] = [a[index], b[index]];
    if (left === right) continue;
    if (typeof left === "number" && typeof right === "number") return left - right;
    return String(left).localeCompare(String(right));
  }
  return 0;
}

/**
 * Render items as Markdown: one `## <Name>` heading per item, its tooltip text, then its other
 * fields as a list. Duplicate names get the item's type appended so no item hides another.
 */
function renderItems(title: string, items: Item[]): string {
  const seen = new Set<string>();
  const sections = items.map((item, index) => {
    const { Name, Help, ...fields } = item;
    let heading = String(Name ?? item.Type ?? `Item ${index + 1}`);
    if (seen.has(heading)) heading = `${heading} (${String(item.Type ?? index + 1)})`;
    seen.add(heading);
    const parts = [`## ${heading}`];
    if (Help !== undefined) parts.push(String(Help));
    const list = jsonToMarkdown(fields, { startingLevel: 3 });
    if (list) parts.push(list);
    return parts.join("\n\n");
  });
  return `# ${title}\n\n${sections.join("\n\n")}\n`;
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
  for (const { tool, file, title, sortKey } of referenceTools) {
    const items = await fetchItems(tool, sortKey);
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
