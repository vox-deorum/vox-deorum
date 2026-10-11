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
 * The records directions: where the records and reference live, which turns are recorded, and
 * which sections to read from files. The text reads only the recorded turns (folders with a
 * complete event slice), so briefing and note commits leave it unchanged within a turn, and the
 * message built from it carries no cache breakpoint.
 *
 * @param context - The run's context, for its store and prompt folder
 */
export function recordsDirections<T extends AgentParameters>(context: VoxContext<T>): string {
  const turns = context.store ? recordedTurns(context.store.manifest()) : [];
  return renderSystemPrompt(context, 'records-directions', {
    hasTurns: turns.length > 0,
    turnRanges: formatTurnRanges(turns),
    latestTurn: turns.at(-1),
    omitted: fileModeOmittedSections.map((key) => ({ title: sections[key].title, files: sectionFiles(sections[key]) })),
  });
}
