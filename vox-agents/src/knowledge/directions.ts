/**
 * @module knowledge/directions
 *
 * File mode: whether a run reads the seat's records through bash, and the records directions
 * that point such a run to them.
 */

import type { AgentParameters } from "../infra/vox-agent.js";
import type { ModelMessage } from "ai";
import type { VoxContext } from "../infra/vox-context.js";
import { renderSystemPrompt } from "../utils/prompts/prompt-files.js";
import { bashToolName } from "../utils/tools/tool-names.js";
import { capOutput, workspaceCwd, workspaceGuide, workspaceGuideFile } from "../utils/workspace/player-workspace.js";
import { formatTurnRanges, recordedTurns, sectionFiles } from "./records.js";
import { fileModeOmittedSections, sections, type SectionKey } from "./sections.js";

/**
 * Whether a run with these declared tools reads records: the context has files on and the tools
 * include bash. Undefined tools mean all registered tools.
 *
 * @param context - The run's context
 * @param tools - The run's declared tools, as {@link VoxAgent.getRunTools} returns them
 */
export function runUsesFiles<T extends AgentParameters>(context: VoxContext<T>, tools: string[] | undefined): boolean {
  if (!context.files) return false;
  return tools === undefined ? bashToolName in context.tools : tools.includes(bashToolName);
}

/**
 * Whether the active execution is in file mode, from the tools the execution loop resolved
 * before prompt preparation. False outside an execution.
 *
 * @param context - The run's context
 */
export function fileMode<T extends AgentParameters>(context: VoxContext<T>): boolean {
  const resolved = context.currentRunTools;
  return resolved !== undefined && runUsesFiles(context, resolved.tools);
}

/**
 * Insert the records directions and the latest notes as system messages, when this execution is
 * in file mode. The directions go first, right after the agent's system prompt and ahead of the
 * game context or overview, so the overview's cache breakpoint covers them. The notes change
 * whenever an agent writes one, so they go after the leading system messages (or at the end when
 * every message is a system message), before the game state.
 *
 * @param inPrompt - Sections the caller already put in the prompt for the latest turn
 */
export function insertRecordsDirections<T extends AgentParameters>(messages: ModelMessage[], context: VoxContext<T>, inPrompt: SectionKey[] = []): void {
  if (!fileMode(context)) return;
  const notes = recordsNotes(context);
  if (notes !== undefined) {
    const at = messages.findIndex((message) => message.role !== "system");
    messages.splice(at === -1 ? messages.length : at, 0, { role: "system", content: notes });
  }
  messages.unshift({ role: "system", content: recordsDirections(context, inPrompt) });
}

/**
 * The game notes guide as an agent would find it: the stored text, or the default guide when the
 * folder is writable and the guide is missing, since the first bash command seeds exactly that
 * (see PlayerWorkspace). Undefined when the seat has no game folder.
 */
function notesGuide<T extends AgentParameters>(context: VoxContext<T>): { writable: boolean; empty: boolean; content: string } | undefined {
  const access = context.files?.game;
  if (!access) return undefined;
  const writable = access === "write";
  const stored = context.store?.readFile(`game/${workspaceGuideFile}`);
  let content = stored === undefined ? "" : Buffer.from(stored).toString("utf8").trim();
  if (stored === undefined && writable && context.store) content = workspaceGuide("game", context.files).trim();
  return { writable, empty: content === "", content };
}

/** How many earlier notes the records directions name after the latest one. */
const earlierNotesShown = 5;

/**
 * The seat's game notes by recency: the text of the most recently written note and the paths of
 * the five before it. The guide and folders are not notes. Undefined when the seat has no game
 * folder or no notes yet.
 */
function recentNotes<T extends AgentParameters>(context: VoxContext<T>): { latest: { path: string; content: string }; earlier: string[] } | undefined {
  const store = context.store;
  if (!context.files?.game || !store) return undefined;
  const notes = [...store.manifest()]
    .filter(([storePath, entry]) => entry.type === "file" && storePath.startsWith("game/") && storePath !== `game/${workspaceGuideFile}`)
    .sort(([pathA, a], [pathB, b]) => b.mtime - a.mtime || pathB.localeCompare(pathA))
    .map(([storePath]) => storePath);
  if (notes.length === 0) return undefined;
  const content = Buffer.from(store.readFile(notes[0]) ?? new Uint8Array()).toString("utf8").trim();
  return {
    latest: { path: `${workspaceCwd}/${notes[0]}`, content: capOutput(content) },
    earlier: notes.slice(1, 1 + earlierNotesShown).map((storePath) => `${workspaceCwd}/${storePath}`),
  };
}

/**
 * The latest game notes for the run, rendered from the `records-notes` prompt file: the text of the
 * most recent note and the paths of the ones before it. Undefined when the seat has no game folder
 * or no notes yet. Built once per run; a note written during the run shows in later runs.
 *
 * @param context - The run's context, for its files setting, store, and prompt folder
 */
export function recordsNotes<T extends AgentParameters>(context: VoxContext<T>): string | undefined {
  const notes = recentNotes(context);
  return notes ? renderSystemPrompt(context, "records-notes", notes) : undefined;
}

/**
 * The records directions: which folders are read-only or writable, which sections to read from
 * files, which are already in the prompt, and the game notes guide. The built-in text names no
 * turn numbers and depends only on the files setting, `inPrompt`, and the guide, so recording a
 * turn, a briefing, or a note leaves it unchanged. The view still supplies the recorded turns and
 * the notes for custom files written for older built-ins (the notes now come from
 * {@link recordsNotes}). It is built once per run, so it stays fixed across the run's steps; an
 * agent editing the guide changes it for later runs. The message built from it carries no cache
 * breakpoint of its own and sits ahead of the caller's.
 *
 * @param context - The run's context, for its files setting, store, and prompt folder
 * @param inPrompt - Sections already in the prompt for the latest turn, named so the run skips them
 */
export function recordsDirections<T extends AgentParameters>(context: VoxContext<T>, inPrompt: SectionKey[] = []): string {
  const files = context.files;
  // Retired names (turns and notes): the built-in text no longer reads them, but a custom file may
  // (see prompt-files)
  const turns = context.store ? recordedTurns(context.store.manifest()) : [];
  return renderSystemPrompt(context, "records-directions", {
    hasTurns: turns.length > 0,
    turnRanges: formatTurnRanges(turns),
    latestTurn: turns.at(-1),
    game: files?.game ? { writable: files.game === "write" } : false,
    shared: Object.entries(files?.shared ?? {}).map(([name, access]) => ({ name, writable: access === "write" })),
    omitted: fileModeOmittedSections
      .filter((key) => !inPrompt.includes(key))
      .map((key) => ({ title: sections[key].title, files: sectionFiles(sections[key]) })),
    inPrompt: inPrompt.map((key) => sections[key].title).join(", ") || false,
    guide: notesGuide(context) ?? false,
    notes: recentNotes(context) ?? false,
  });
}
