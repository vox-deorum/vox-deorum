/**
 * @module knowledge/records
 *
 * Writes a seat's records tree (`records/` in its workspace store): complete reports for each
 * processed turn, game-scoped sections, generated briefings, and the catalog. Only the host
 * writes records; agents read them through the read-only `/workspace/records` mount.
 */

import type { ConsolidatedEventsReport } from "../../../mcp-server/dist/tools/knowledge/get-events.js";
import type { GameState, StrategistParameters } from "../strategist/strategy-parameters.js";
import { filterEventsByCategory, type EventCategory } from "../utils/prompts/event-filters.js";
import { jsonToMarkdown, type JsonToMarkdownConfig } from "../utils/tools/json-to-markdown.js";
import type { CommitID, Manifest, PathChange, WorkspaceStore } from "../utils/workspace/workspace-store.js";
import { renderSection, sections, type SectionDefinition, type SectionKey, type SectionSplit } from "./sections.js";

/** Briefing kinds archived under `records/turn-<N>/briefings/`. */
export type BriefingKind = 'combined' | 'military' | 'economy' | 'diplomacy';

/** Store folder of the records tree. */
const recordsRoot = 'records';

/** Store path of the generated catalog. */
export const catalogPath = `${recordsRoot}/CATALOG.md`;

/** Event category files written for every processed turn, by file suffix. */
export const eventCategoryFiles: ReadonlyArray<readonly [suffix: string, category: EventCategory]> = [
  ['economic', 'Economy'],
  ['military', 'Military'],
  ['diplomatic', 'Diplomacy'],
  ['others', 'Others'],
  ['system', 'System'],
];

/** Turn-scoped sections written as complete reports, in catalog order. Events have their own files. */
const turnSectionKeys: SectionKey[] = ['options', 'strategies', 'victory', 'players', 'cities', 'military'];

/** The store folder of one processed turn. */
function turnFolder(turn: number): string {
  return `${recordsRoot}/turn-${turn}`;
}

/** A copy of a report without its `_markdownConfig` rendering hint, for JSON files. */
function withoutMarkdownConfig(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const { _markdownConfig: _ignored, ...rest } = data as Record<string, unknown>;
  return rest;
}

/** Pretty JSON for a record file. */
function toJson(data: unknown): string {
  return `${JSON.stringify(withoutMarkdownConfig(data), null, 2)}\n`;
}

/** A readable file name for a split part: lowercase words joined by dashes. */
function slug(label: string): string {
  const cleaned = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'part';
}

/** The label of one top-level entry of a report being split. */
function partLabel(key: SectionKey, entryKey: string, value: unknown): string {
  if (key === 'players') {
    const civilization = value && typeof value === 'object' ? (value as { Civilization?: unknown }).Civilization : undefined;
    return typeof civilization === 'string' && civilization ? civilization : `player-${entryKey}`;
  }
  return entryKey;
}

/** One top-level entry of a report being split, with its label and file name (no extension). */
interface SplitEntry { entry: string; value: unknown; label: string; name: string }

/**
 * The top-level entries of a report being split (civilizations, city owners, or military zones).
 * Each gets a readable slug, with a numeric suffix when two entries would share a name.
 */
export function splitEntries(key: SectionKey, data: unknown): SplitEntry[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const used = new Set<string>();
  const entries: SplitEntry[] = [];
  for (const [entry, value] of Object.entries(data as Record<string, unknown>)) {
    if (entry.startsWith('_')) continue;
    const label = partLabel(key, entry, value);
    const base = slug(label);
    let name = base;
    for (let index = 2; used.has(name); index++) name = `${base}-${index}`;
    used.add(name);
    entries.push({ entry, value, label, name });
  }
  return entries;
}

/** Split a report's Markdown by its top-level entries, each part keeping the report's heading configuration. */
function splitParts(key: SectionKey, data: unknown): Array<{ name: string; content: string }> {
  const report = data as Record<string, unknown>;
  const config = sections[key].markdown ?? (report?._markdownConfig as Partial<JsonToMarkdownConfig> | undefined) ?? {};
  return splitEntries(key, data).map(({ entry, value, label, name }) => ({
    name,
    content: `# ${sections[key].title}: ${label}\n\n${jsonToMarkdown({ [entry]: value }, config)}\n`,
  }));
}

/** The data each turn-scoped section records, read from the turn's state. */
function turnSectionData(state: GameState): Partial<Record<SectionKey, unknown>> {
  const data: Partial<Record<SectionKey, unknown>> = {
    victory: state.victory,
    players: state.players,
    cities: state.cities,
    military: state.military,
  };
  if (state.options) {
    const { Options, ...strategies } = state.options;
    data.options = Options;
    data.strategies = strategies;
  }
  return data;
}

/** The complete record files of one turn-scoped section: Markdown, JSON, and split parts. */
function sectionChanges(folder: string, key: SectionKey, data: unknown): PathChange[] {
  const changes: PathChange[] = [
    { path: `${folder}/${key}.md`, type: 'file', content: `${renderSection(key, data)}\n` },
    { path: `${folder}/${key}.json`, type: 'file', content: toJson(data) },
  ];
  if (sections[key].split) {
    for (const part of splitParts(key, data)) {
      changes.push({ path: `${folder}/${key}/${part.name}.md`, type: 'file', content: part.content });
    }
  }
  return changes;
}

/** The event files of one processed refresh: the complete slice and the five category views. */
function eventChanges(folder: string, events: ConsolidatedEventsReport): PathChange[] {
  const changes: PathChange[] = [
    {
      path: `${folder}/events-all.md`,
      type: 'file',
      content: `${renderSection('events', events, { description: 'Events: the complete event slice of this processed refresh.' })}\n`,
    },
    { path: `${folder}/events-all.json`, type: 'file', content: toJson(events) },
  ];
  for (const [suffix, category] of eventCategoryFiles) {
    const filtered = filterEventsByCategory(events, category);
    changes.push({
      path: `${folder}/events-${suffix}.md`,
      type: 'file',
      content: `${renderSection('events', filtered, {
        heading: `Events: ${category}`,
        description: `Events: ${category.toLowerCase()} events of this processed refresh.`,
      })}\n`,
    });
  }
  return changes;
}

/**
 * Compress sorted turn numbers into ranges, such as `1-40, 42`.
 *
 * @param turns - Turn numbers in any order; duplicates are ignored
 */
export function formatTurnRanges(turns: number[]): string {
  const sorted = [...new Set(turns)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < sorted.length;) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    ranges.push(end === index ? `${sorted[index]}` : `${sorted[index]}-${sorted[end]}`);
    index = end + 1;
  }
  return ranges.join(', ');
}

/** A byte count as a short readable size. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Readable names of the split groupings. */
const splitLabels: Record<SectionSplit['by'], string> = {
  civilization: 'civilization',
  cityOwner: 'city owner',
  militaryZone: 'military zone',
};

/** Where one section's record files live, for the catalog's section index. */
export function sectionFiles(section: SectionDefinition): string {
  if (section.scope === 'game') return `\`game/${section.key}.md\``;
  if (section.key === 'events') {
    return `\`turn-<N>/events-all.md\`, and views by category: ${eventCategoryFiles.map(([suffix]) => `\`events-${suffix}.md\``).join(', ')}`;
  }
  if (section.key === 'briefings') return '`turn-<N>/briefings/<kind>.md`: combined, military, economy, diplomacy';
  const split = section.split ? `, one file per ${splitLabels[section.split.by]} in \`turn-<N>/${section.key}/\`` : '';
  return `\`turn-<N>/${section.key}.md\`${split}`;
}

/**
 * The processed turns recorded in a records tree, ascending. A turn counts once its complete
 * event slice is written, so a folder holding only briefings does not count.
 *
 * @param tree - The store version to read
 */
export function recordedTurns(tree: Manifest): number[] {
  const recorded: number[] = [];
  for (const storePath of tree.keys()) {
    const match = /^records\/turn-(\d+)\/events-all\.json$/.exec(storePath);
    if (match) recorded.push(Number(match[1]));
  }
  return recorded.sort((a, b) => a - b);
}

/**
 * Build the catalog for a records tree: the layout, a section index, recorded turn ranges, any
 * missing processed-turn folders, and the latest files' sizes. General advice on reading large
 * files is in the workspace section of the system prompt (prompts/workspace.md).
 *
 * @param tree - The store version the catalog describes
 */
export function buildCatalog(tree: Manifest): string {
  const turns = recordedTurns(tree);
  const recorded = new Set(turns);
  const briefed = new Set<number>();
  for (const storePath of tree.keys()) {
    const match = /^records\/turn-(\d+)\/briefings\//.exec(storePath);
    if (match) briefed.add(Number(match[1]));
  }
  const latest = turns.at(-1);
  const missing: number[] = [];
  if (latest !== undefined) {
    for (let turn = turns[0]; turn < latest; turn++) if (!recorded.has(turn)) missing.push(turn);
  }
  const briefingOnly = [...briefed].filter((turn) => !recorded.has(turn));

  const lines: string[] = [
    '# Records catalog',
    'The host writes these files after each processed turn and each generated briefing. They are read-only.',
    '',
    '## Sections',
    '| Section | Files |',
    '| --- | --- |',
    ...Object.values(sections).map((section) => `| ${section.title} | ${sectionFiles(section)} |`),
    '',
    'Each complete report has Markdown and a JSON twin with the same name. Split parts, event category views, and briefings are Markdown only.',
    '',
    '## Turns',
    `- Recorded turns: ${turns.length > 0 ? formatTurnRanges(turns) : 'none yet'}`,
  ];
  if (missing.length > 0) lines.push(`- Missing processed-turn folders: ${formatTurnRanges(missing)}`);
  if (briefingOnly.length > 0) lines.push(`- Briefings only, turn not recorded yet: ${formatTurnRanges(briefingOnly)}`);
  lines.push(
    '- Each `turn-<N>` folder is one processed refresh. Events inside keep their real turn keys, so a folder can hold events from a dropped or earlier turn. To find every event of a game turn, search all folders, for example `grep -rn "## Turn 41" turn-*/events-all.md`.',
  );

  const sizeRows = (prefix: string): string[] => [...tree.entries()]
    .filter(([storePath, entry]) => entry.type === 'file' && storePath.startsWith(prefix))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([storePath, entry]) => `| \`${storePath.slice(recordsRoot.length + 1)}\` | ${formatSize(entry.type === 'file' ? entry.size : 0)} |`);
  const latestRows = [
    ...sizeRows(`${recordsRoot}/game/`),
    ...(latest !== undefined ? sizeRows(`${turnFolder(latest)}/`) : []),
  ];
  if (latestRows.length > 0) {
    lines.push('', '## Latest file sizes', '| File | Size |', '| --- | --- |', ...latestRows);
  }
  return `${lines.join('\n')}\n`;
}

/** The derived catalog change for a commit, computed from the tree it produces. */
function deriveCatalog(tree: Manifest): PathChange[] {
  return [{ path: catalogPath, type: 'file', content: buildCatalog(tree) }];
}

/** Whether stored bytes hold exactly the given text. */
function sameContent(stored: Uint8Array | undefined, content: string): boolean {
  return stored !== undefined && Buffer.from(stored).toString('utf8') === content;
}

/** The host writer of one seat's records. */
export class SeatRecords {
  /** @param store - The seat's workspace store */
  constructor(public readonly store: WorkspaceStore) {}

  /**
   * Record one processed turn's factual sections in one `turn` commit for `state.turn`: complete
   * reports with split parts, the refresh's event slice with its category views, and the
   * game-wide sections when they are missing or changed. The catalog is derived in the same
   * commit. Errors propagate.
   *
   * @param parameters - The seat's parameters, for the game metadata
   * @param state - The processed turn's state
   */
  recordTurn(parameters: StrategistParameters, state: GameState): CommitID {
    const folder = turnFolder(state.turn);
    const changes: PathChange[] = [];
    const data = turnSectionData(state);
    for (const key of turnSectionKeys) {
      if (data[key] !== undefined) changes.push(...sectionChanges(folder, key, data[key]));
    }
    changes.push(...eventChanges(folder, (state.events ?? {}) as ConsolidatedEventsReport));
    changes.push(...this.gameChanges(parameters));

    return this.store.commit({ kind: 'turn', turn: state.turn, author: 'host', changes, derive: deriveCatalog });
  }

  /**
   * Archive one generated briefing in one `briefing` commit, replacing any earlier file of the same
   * turn and kind. The catalog is derived in the same commit.
   *
   * @param turn - The turn of the state the briefing was requested for
   * @param kind - The briefing kind
   * @param text - The briefing text
   * @param signal - The requesting run's signal; an aborted run writes nothing
   */
  recordBriefing(turn: number, kind: BriefingKind, text: string, signal?: AbortSignal): CommitID {
    return this.store.commit({
      kind: 'briefing',
      turn,
      author: 'host',
      changes: [{ path: `${turnFolder(turn)}/briefings/${kind}.md`, type: 'file', content: text.endsWith('\n') ? text : `${text}\n` }],
      derive: deriveCatalog,
      signal,
    });
  }

  /** Game-wide section files that are missing from head or differ from the current metadata. */
  private gameChanges(parameters: StrategistParameters): PathChange[] {
    if (!parameters.metadata) return [];
    const { YouAre, ...situation } = parameters.metadata;
    const files: Array<[string, string]> = [];
    for (const [key, data] of [['situation', situation], ['civilization', YouAre]] as const) {
      if (data === undefined) continue;
      files.push([`${recordsRoot}/game/${key}.md`, `${renderSection(key, data)}\n`]);
      files.push([`${recordsRoot}/game/${key}.json`, toJson(data)]);
    }
    return files
      .filter(([storePath, content]) => !sameContent(this.store.readFile(storePath), content))
      .map(([storePath, content]) => ({ path: storePath, type: 'file' as const, content }));
  }
}
