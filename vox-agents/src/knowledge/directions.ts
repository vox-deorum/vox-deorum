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
import { workspaceGuide, workspaceGuideFile } from "../utils/workspace/player-workspace.js";
import { formatTurnRanges, recordedTurns, sectionFiles } from "./records.js";
import { fileModeOmittedSections, sections } from "./sections.js";

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

/** Append records directions at the caller's chosen position when this execution is in file mode. */
export function appendRecordsDirections<T extends AgentParameters>(messages: ModelMessage[], context: VoxContext<T>): void {
  if (fileMode(context)) messages.push({ role: "user", content: recordsDirections(context) });
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
  if (stored === undefined && writable && context.store) content = workspaceGuide("game").trim();
  return { writable, empty: content === "", content };
}

/**
 * The records directions: which folders are read-only or writable, which turns are recorded,
 * which sections to read from files, and the game notes guide. The text reads only the recorded
 * turns (folders with a complete event slice) and the guide, so briefing commits leave it
 * unchanged within a turn, and the message built from it carries no cache breakpoint. An agent
 * editing the guide changes it for later runs.
 *
 * @param context - The run's context, for its files setting, store, and prompt folder
 */
export function recordsDirections<T extends AgentParameters>(context: VoxContext<T>): string {
  const turns = context.store ? recordedTurns(context.store.manifest()) : [];
  const files = context.files;
  return renderSystemPrompt(context, "records-directions", {
    game: files?.game ? { writable: files.game === "write" } : false,
    shared: Object.entries(files?.shared ?? {}).map(([name, access]) => ({ name, writable: access === "write" })),
    hasTurns: turns.length > 0,
    turnRanges: formatTurnRanges(turns),
    latestTurn: turns.at(-1),
    omitted: fileModeOmittedSections.map((key) => ({ title: sections[key].title, files: sectionFiles(sections[key]) })),
    guide: notesGuide(context) ?? false,
  });
}
