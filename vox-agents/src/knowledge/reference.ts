/**
 * @module knowledge/reference
 *
 * Writes the game reference into each file-enabled seat's workspace store: the technologies,
 * policies, buildings, and units of the game database with their full details and the game's own
 * tooltips, trimmed and in game order, as Markdown and JSON. Each category gets a folder under
 * `reference/` with a `.md` and `.json` pair per bucket: one per era for technologies, buildings,
 * and units (plus `other` for entries no technology unlocks), and one per branch for policies. The
 * file name carries the bucket, so entries keep no `Era` or `Branch` field. The Markdown lists only
 * the facts a category's tooltips lack; the JSON keeps every fact. Each seat mounts it read-only,
 * and its commits keep it next to the records, so a recorded version holds everything the seat's
 * bash workspace showed.
 */

import { mcpClient } from "../utils/models/mcp-client.js";
import { unwrapMcpResponse } from "../utils/models/mcp-response.js";
import { renderReferenceMarkdown } from "./reference-format.js";
import { isRecord } from "../utils/guards.js";
import { createLogger } from "../utils/logger.js";
import { referenceStoreFolder, referenceStorePrefix, type PathChange, type WorkspaceStore } from "../utils/workspace/workspace-store.js";

const logger = createLogger('GameReference');

type Item = Record<string, unknown>;

/** Era file names, including `other` for entries with an unknown era or no unlocking technology. */
const referenceEras = ["ancient", "classical", "medieval", "renaissance", "industrial", "modern", "atomic", "information", "other"];

/** Sort key for one listing within its bucket: units, buildings, and technologies by cost; policies by level. */
type SortKey = (item: Item) => (string | number)[];

/** Cost, the order the game unlocks most entries in. */
const byCost: SortKey = (item) => [numberOf(item.Cost)];

/** Where a policy sits in its branch tree. */
const byLevel: SortKey = (item) => [numberOf(item.Level)];

/** One bucket an entry is filed under: its file name and the label for the file title. */
type Bucket = { file: string; label: string };

/** Choose the bucket of one trimmed entry. */
type BucketOf = (item: Item) => Bucket;

/**
 * One listing in the reference: its tool, folder name, title, bucketing, order, the fields its
 * Markdown lists as facts, and the fields used only for bucketing and sorting.
 */
type ReferenceTool = {
  tool: string;
  file: string;
  title: string;
  bucketOf: BucketOf;
  sortKey: SortKey;
  facts: string[];
  sortOnly: string[];
};

/** The database tools the reference lists. Facts are the fields the game's tooltips leave out. */
const referenceTools: ReferenceTool[] = [
  { tool: "get-technology", file: "technologies", title: "Technologies", bucketOf: eraBucket, sortKey: byCost, facts: ["Cost", "TechsPrereq"], sortOnly: ["Era"] },
  { tool: "get-policy", file: "policies", title: "Policies", bucketOf: branchBucket, sortKey: byLevel, facts: ["PrereqPolicies"], sortOnly: ["Era", "Branch", "Level"] },
  { tool: "get-building", file: "buildings", title: "Buildings", bucketOf: unlockBucket, sortKey: byCost, facts: ["Replaces", "UniqueOf", "IsWorldWonder", "IsNationalWonder"], sortOnly: ["Era"] },
  { tool: "get-unit", file: "units", title: "Units", bucketOf: unlockBucket, sortKey: byCost, facts: ["UpgradedFrom", "UpgradesTo", "Replaces", "UniqueOf", "Maintenance"], sortOnly: ["Era"] },
];

/** Upper bound on listing rows, large enough to return every row of each table. */
const referenceMaxResults = 5000;

/** Bump when generated reference files need to be refreshed in existing games. */
const referenceFormatVersion = "3\n";
/** Workspace path of the generated format marker. */
const referenceVersionPath = `${referenceStorePrefix}.format-version`;

/** Fields whose zero means "none" and is dropped. */
const zeroMeansNone = new Set(["Combat", "RangedCombat", "Range", "Maintenance", "Happiness", "Defense", "HP"]);

/** Fields left out of the reference: internal identifiers and advice the tooltip supersedes. */
const omittedFields = new Set(["Type", "AIType", "Strategy", "Description"]);

/** The `other` bucket, for entries outside the era order. */
const otherBucket: Bucket = { file: "other", label: "Other" };

/**
 * Choose an entry's era bucket. Entries without an era, such as starting units, are ancient, as the
 * database tools already report for other categories. An unknown era goes to `other` with a warning.
 */
function eraBucket(item: Item): Bucket {
  if (item.Era === undefined) return { file: "ancient", label: "Ancient Era" };
  const era = String(item.Era).toLowerCase();
  if (referenceEras.includes(era) && era !== "other") return { file: era, label: `${String(item.Era)} Era` };
  logger.warn(`Unknown era ${String(item.Era)} for ${String(item.Name)}; filing it under other`);
  return otherBucket;
}

/**
 * Choose a building's or unit's bucket: `other` when no technology unlocks it and it has no
 * production cost, such as great people, faith units, and corporation buildings; its era otherwise.
 * Starting entries such as the Warrior or Monument have a cost and stay ancient.
 */
function unlockBucket(item: Item): Bucket {
  if (item.PrereqTech === undefined && numberOf(item.Cost) <= 0) return otherBucket;
  return eraBucket(item);
}

/** Choose a policy's bucket: its branch, titled with the branch's era, or `other` without a branch. */
function branchBucket(item: Item): Bucket {
  if (typeof item.Branch !== "string" || item.Branch === "") return otherBucket;
  const era = typeof item.Era === "string" && item.Era !== "" ? ` (${item.Era} Era)` : "";
  return { file: slug(item.Branch), label: `${item.Branch}${era}` };
}

/** A file name for a bucket label: lowercase words joined by dashes, keeping letters of any script. */
function slug(label: string): string {
  const cleaned = label.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return cleaned || "other";
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

/** One filled bucket of a listing: its file name, file title label, and sorted entries. */
type FilledBucket = Bucket & { items: Item[] };

/**
 * Fetch one database tool's full reports as filled buckets; a bucket no entry lands in is left out.
 * Entries are trimmed, grouped by the listing's bucket, sorted within the bucket by the listing's
 * key and then by name, and rebuilt without the sort-only fields. The unit tool already leaves out
 * barbarian-only units.
 *
 * @throws on an MCP error, an `Error` field in the result, or a result without an item list
 */
async function fetchBuckets({ tool, bucketOf, sortKey, sortOnly }: ReferenceTool): Promise<FilledBucket[]> {
  const result = unwrapMcpResponse(await mcpClient.callTool(tool, { MaxResults: referenceMaxResults, Detailed: true }), tool);
  if (result.Error) throw new Error(`${tool} failed: ${String(result.Error)}`);
  if (!Array.isArray(result.Items)) throw new Error(`${tool} returned no item list.`);
  const grouped = new Map<string, Bucket & { keyed: { item: Item; key: (string | number)[] }[] }>();
  for (const raw of result.Items) {
    const item = trimValue(raw);
    if (!isRecord(item)) continue;
    const bucket = bucketOf(item);
    if (!grouped.has(bucket.file)) grouped.set(bucket.file, { ...bucket, keyed: [] });
    grouped.get(bucket.file)!.keyed.push({ item, key: [...sortKey(item), String(item.Name ?? "")] });
  }
  return [...grouped.values()].map(({ file, label, keyed }) => {
    keyed.sort((a, b) => compareKeys(a.key, b.key));
    return { file, label, items: keyed.map(({ item }) => {
      const { Name, Help, ...facts } = item;
      for (const field of sortOnly) delete facts[field];
      return {
        ...(Name === undefined ? {} : { Name }),
        ...facts,
        ...(Help === undefined ? {} : { Help }),
      };
    }) };
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

/**
 * Whether the store holds the reference in the current generated format: the format marker, and
 * in every category folder at least one Markdown file whose JSON twin is also there.
 */
export function hasGameReference(store: WorkspaceStore): boolean {
  const marker = store.readFile(referenceVersionPath);
  if (!marker || Buffer.from(marker).toString("utf8") !== referenceFormatVersion) return false;
  const manifest = store.manifest();
  return referenceTools.every(({ file }) => {
    const folder = `${referenceStorePrefix}${file}/`;
    return [...manifest.entries()].some(([storePath, entry]) => entry.type === "file"
      && storePath.startsWith(folder) && storePath.endsWith(".md")
      && manifest.get(`${storePath.slice(0, -".md".length)}.json`)?.type === "file");
  });
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
    for (const { file, label, items } of await fetchBuckets(spec)) {
      changes.push(
        { path: `${referenceStorePrefix}${spec.file}/${file}.md`, type: "file", content: renderReferenceMarkdown(`${spec.title}: ${label}`, items, spec.facts) },
        { path: `${referenceStorePrefix}${spec.file}/${file}.json`, type: "file", content: `${JSON.stringify(items, null, 2)}\n` },
      );
    }
  }
  for (const store of missing) {
    store.commit({ kind: "reference", turn: null, author: "host", changes });
  }
  logger.info(`Wrote the game reference into ${missing.length} seat store(s)`);
  return missing.length;
}
