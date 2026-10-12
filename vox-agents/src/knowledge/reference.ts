/**
 * @module knowledge/reference
 *
 * Writes the game reference into each file-enabled seat's workspace store: the technologies,
 * policies, buildings, and units of the game database with their full details and the game's own
 * tooltips, trimmed and in game order, as Markdown and JSON. Each category gets a folder under
 * `reference/` and each era a `.md` and `.json` pair inside it, so the file name carries the era
 * and entries keep no `Era` field. Each seat mounts it read-only, and its commits keep it next to
 * the records, so a recorded version holds everything the seat's bash workspace showed.
 */

import { mcpClient } from "../utils/models/mcp-client.js";
import { unwrapMcpResponse } from "../utils/models/mcp-response.js";
import { renderReferenceMarkdown } from "./reference-format.js";
import { isRecord } from "../utils/guards.js";
import { createLogger } from "../utils/logger.js";
import { referenceStoreFolder, referenceStorePrefix, type PathChange, type WorkspaceStore } from "../utils/workspace/workspace-store.js";

const logger = createLogger('GameReference');

type Item = Record<string, unknown>;

/** Era file names, including `other` for entries with an unknown era. */
const referenceEras = ["ancient", "classical", "medieval", "renaissance", "industrial", "modern", "atomic", "information", "other"];

/** Sort key for one listing within its era bucket: units, buildings, and technologies by cost; policies by branch then level. */
type SortKey = (item: Item) => (string | number)[];

/** Cost, the order the game unlocks most entries in. */
const byCost: SortKey = (item) => [numberOf(item.Cost)];

/** Where a policy sits in its branch tree. */
const byBranchAndLevel: SortKey = (item) => [String(item.Branch ?? ""), numberOf(item.Level)];

/** One listing in the reference: its tool, folder name, title, order, and fields used only for sorting. */
type ReferenceTool = { tool: string; file: string; title: string; sortKey: SortKey; sortOnly?: string[] };

/** The database tools the reference lists. */
const referenceTools: ReferenceTool[] = [
  { tool: "get-technology", file: "technologies", title: "Technologies", sortKey: byCost },
  { tool: "get-policy", file: "policies", title: "Policies", sortKey: byBranchAndLevel, sortOnly: ["Level"] },
  { tool: "get-building", file: "buildings", title: "Buildings", sortKey: byCost },
  { tool: "get-unit", file: "units", title: "Units", sortKey: byCost },
];

/** Upper bound on listing rows, large enough to return every row of each table. */
const referenceMaxResults = 5000;

/** Bump when generated reference files need to be refreshed in existing games. */
const referenceFormatVersion = "2\n";
/** Workspace path of the generated format marker. */
const referenceVersionPath = `${referenceStorePrefix}.format-version`;

/** Fields whose zero means "none" and is dropped. */
const zeroMeansNone = new Set(["Combat", "RangedCombat", "Range", "Maintenance", "Happiness", "Defense", "HP"]);

/** Fields left out of the reference: internal identifiers and advice the tooltip supersedes. */
const omittedFields = new Set(["Type", "AIType", "Strategy", "Description"]);

/**
 * Choose an entry's era bucket. Entries without an era, such as starting units, are ancient, as the
 * database tools already report for other categories. An unknown era goes to `other` with a warning.
 */
function eraBucket(item: Item): string {
  if (item.Era === undefined) return "ancient";
  const era = String(item.Era).toLowerCase();
  if (referenceEras.includes(era)) return era;
  logger.warn(`Unknown era ${String(item.Era)} for ${String(item.Name)}; filing it under other`);
  return "other";
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
 * Fetch one database tool's full reports as era buckets: every era gets a list, empty when no
 * entry lands in it. Entries are trimmed, grouped by their era, sorted within the bucket by the
 * listing's key and then by name, and rebuilt without the `Era` and sort-only fields. The unit
 * tool already leaves out barbarian-only units.
 *
 * @throws on an MCP error, an `Error` field in the result, or a result without an item list
 */
async function fetchBuckets({ tool, sortKey, sortOnly = [] }: ReferenceTool): Promise<Map<string, Item[]>> {
  const result = unwrapMcpResponse(await mcpClient.callTool(tool, { MaxResults: referenceMaxResults, Detailed: true }), tool);
  if (result.Error) throw new Error(`${tool} failed: ${String(result.Error)}`);
  if (!Array.isArray(result.Items)) throw new Error(`${tool} returned no item list.`);
  const grouped = new Map(referenceEras.map((era) => [era, [] as { item: Item; key: (string | number)[] }[]]));
  for (const raw of result.Items) {
    const item = trimValue(raw);
    if (isRecord(item)) grouped.get(eraBucket(item))!.push({ item, key: [...sortKey(item), String(item.Name ?? "")] });
  }
  const buckets = new Map<string, Item[]>();
  for (const [era, keyed] of grouped) {
    keyed.sort((a, b) => compareKeys(a.key, b.key));
    buckets.set(era, keyed.map(({ item }) => {
      const { Name, Help, ...facts } = item;
      delete facts.Era;
      for (const field of sortOnly) delete facts[field];
      return {
        ...(Name === undefined ? {} : { Name }),
        ...facts,
        ...(Help === undefined ? {} : { Help }),
      };
    }));
  }
  return buckets;
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

/** Whether the store holds every category's era file pairs in the current generated format. */
export function hasGameReference(store: WorkspaceStore): boolean {
  const marker = store.readFile(referenceVersionPath);
  if (!marker || Buffer.from(marker).toString("utf8") !== referenceFormatVersion) return false;
  const manifest = store.manifest();
  return referenceTools.every(({ file }) => referenceEras.every((era) => ["md", "json"].every(
    (extension) => manifest.get(`${referenceStorePrefix}${file}/${era}.${extension}`)?.type === "file",
  )));
}

/**
 * Replace each outdated or incomplete store's reference in one commit. Fetch all four listings
 * once before writing any store, and share the generated changes across stores.
 *
 * @param stores - The file-enabled seats' stores
 * @returns how many stores received the reference
 * @throws on any fetch, result, or commit failure; a failed fetch writes nothing
 */
export async function writeGameReference(stores: WorkspaceStore[]): Promise<number> {
  const missing = stores.filter((store) => !hasGameReference(store));
  if (missing.length === 0) return 0;

  const changes: PathChange[] = [
    { path: referenceStoreFolder, type: "delete" },
    { path: referenceVersionPath, type: "file", content: referenceFormatVersion },
  ];
  for (const spec of referenceTools) {
    for (const [era, items] of await fetchBuckets(spec)) {
      changes.push(
        { path: `${referenceStorePrefix}${spec.file}/${era}.md`, type: "file", content: renderReferenceMarkdown(spec.title, items) },
        { path: `${referenceStorePrefix}${spec.file}/${era}.json`, type: "file", content: `${JSON.stringify(items, null, 2)}\n` },
      );
    }
  }
  for (const store of missing) {
    store.commit({ kind: "reference", turn: null, author: "host", changes });
  }
  logger.info(`Wrote the game reference into ${missing.length} seat store(s)`);
  return missing.length;
}
