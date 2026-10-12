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
import { renderReferenceMarkdown } from "./reference-format.js";
import { isRecord } from "../utils/guards.js";
import { createLogger } from "../utils/logger.js";
import { referenceStorePrefix, type PathChange, type WorkspaceStore } from "../utils/workspace/workspace-store.js";

const logger = createLogger('GameReference');

type Item = Record<string, unknown>;

/** Sort key for one listing: units, buildings, and technologies by era then cost; policies by era, branch, then level. */
type SortKey = (item: Item) => (string | number)[];

/** Era, then cost, the order the game unlocks most entries in. */
const byEraAndCost: SortKey = (item) => [eraRank(item.Era), numberOf(item.Cost)];

/** One listing in the reference: its tool, file name, title, order, and fields used only for sorting. */
type ReferenceTool = { tool: string; file: string; title: string; sortKey: SortKey; sortOnly?: string[] };

/** The database tools the reference lists. */
const referenceTools: ReferenceTool[] = [
  { tool: "get-technology", file: "technologies", title: "Technologies", sortKey: byEraAndCost },
  { tool: "get-policy", file: "policies", title: "Policies", sortKey: (item) => [eraRank(item.Era), String(item.Branch ?? ""), numberOf(item.Level)], sortOnly: ["Level"] },
  { tool: "get-building", file: "buildings", title: "Buildings", sortKey: byEraAndCost },
  { tool: "get-unit", file: "units", title: "Units", sortKey: byEraAndCost },
];

/** Upper bound on listing rows, large enough to return every row of each table. */
const referenceMaxResults = 5000;

/** Bump when generated reference files need to be refreshed in existing games. */
const referenceFormatVersion = "1\n";
/** Workspace path of the generated format marker. */
const referenceVersionPath = `${referenceStorePrefix}.format-version`;

/** Era names in game order, as the database tools report them. */
const eraOrder = ["Ancient", "Classical", "Medieval", "Renaissance", "Industrial", "Modern", "Atomic", "Information"];

/** Fields whose zero means "none" and is dropped. */
const zeroMeansNone = new Set(["Combat", "RangedCombat", "Range", "Maintenance", "Happiness", "Defense", "HP"]);

/** Fields left out of the reference: internal identifiers and advice the tooltip supersedes. */
const omittedFields = new Set(["Type", "AIType", "Strategy", "Description"]);

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
 * Fetch one database tool's full reports, trimmed, sorted by the listing's key and then by name,
 * and without the listing's sort-only fields. The unit tool already leaves out barbarian-only units.
 *
 * @throws on an MCP error, an `Error` field in the result, or a result without an item list
 */
async function fetchItems({ tool, sortKey, sortOnly = [] }: ReferenceTool): Promise<Item[]> {
  const result = unwrapMcpResponse(await mcpClient.callTool(tool, { MaxResults: referenceMaxResults, Detailed: true }), tool);
  if (result.Error) throw new Error(`${tool} failed: ${String(result.Error)}`);
  if (!Array.isArray(result.Items)) throw new Error(`${tool} returned no item list.`);
  const items = result.Items
    .map((item) => trimValue(item))
    .filter((item): item is Item => isRecord(item));
  const keyed = items.map((item) => ({ item, key: [...sortKey(item), String(item.Name ?? "")] }));
  keyed.sort((a, b) => compareKeys(a.key, b.key));
  return keyed.map(({ item }) => {
    const { Name, Help, ...facts } = item;
    for (const field of sortOnly) delete facts[field];
    return {
      ...(Name === undefined ? {} : { Name }),
      ...facts,
      ...(Help === undefined ? {} : { Help }),
    };
  });
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

/** Whether the store holds all eight reference files in the current generated format. */
export function hasGameReference(store: WorkspaceStore): boolean {
  const marker = store.readFile(referenceVersionPath);
  if (!marker || Buffer.from(marker).toString("utf8") !== referenceFormatVersion) return false;
  const manifest = store.manifest();
  return referenceTools.every(({ file }) => ["md", "json"].every(
    (extension) => manifest.get(`${referenceStorePrefix}${file}.${extension}`)?.type === "file",
  ));
}

/**
 * Write the game reference into each outdated or incomplete store as one `reference` commit.
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
  for (const spec of referenceTools) {
    const { file, title } = spec;
    const items = await fetchItems(spec);
    changes.push(
      { path: `${referenceStorePrefix}${file}.md`, type: "file", content: renderReferenceMarkdown(title, items) },
      { path: `${referenceStorePrefix}${file}.json`, type: "file", content: `${JSON.stringify(items, null, 2)}\n` },
    );
  }
  changes.push({ path: referenceVersionPath, type: "file", content: referenceFormatVersion });
  for (const store of missing) {
    store.commit({ kind: "reference", turn: null, author: "host", changes });
  }
  logger.info(`Wrote the game reference into ${missing.length} seat store(s)`);
  return missing.length;
}
