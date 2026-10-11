/**
 * @module utils/prompts/closing-reminder
 *
 * The closing reminder appended as the last user message of each step (see
 * VoxAgent.continuationNudge). The whole prompt is one template so its wording can be edited in
 * one place.
 */

import { bashToolName, formatToolChoiceList } from '../tools/tool-names.js';

/**
 * Builds the single closing reminder appended to a step. Each template line is one part and
 * is left empty when it does not apply; empty lines are dropped and the rest joined with spaces.
 * - Requirement: the step's tool choice is required. It lives here rather than in the provider
 *   middleware's system text, so a step that drops to auto changes only the end of the prompt.
 * - Tool policy: the step was narrowed below the run's declared tools, which stay declared to the
 *   model, so it names what may actually run.
 * - Steps left: the run counts its steps down (files on).
 * - Finalize: from the second step on, the completion tools allowed on this step. With `notes`
 *   (bash may run and a workspace folder is writable), it explicitly asks the model to save notes
 *   with bash in that same response, since a finishing call ends the run and there is no
 *   subsequent step.
 * Returns undefined when no sentence applies.
 *
 * @param executable - The tools that may run on this step
 * @param completionTools - The agent's completion tools
 * @param options - Whether the step is narrowed, its index, whether a call is required, the steps left, and whether notes can be written
 */
export function buildClosingReminder(
  executable: string[],
  completionTools: string[] | undefined,
  options: { narrowed: boolean; step: number; required: boolean; stepsLeft?: number; notes?: boolean },
): string | undefined {
  const { narrowed, step, required, stepsLeft, notes } = options;
  const allowed = new Set(executable);
  const tools = formatToolChoiceList(executable);
  const finishing = formatToolChoiceList((completionTools ?? []).filter((name) => allowed.has(name)));

  const reminder = `
${required ? `IMPORTANT: You must issue tool calls to collect information or make actions. Whenever possible, call all tools you need at once.` : ''}
${!narrowed ? '' : tools ? `For this step, you may only call ${tools}; other tools will return an error.` : `No tools are available for this step. Write response in plain text.`}
${stepsLeft === undefined ? '' : stepsLeft > 1 ? `IMPORTANT: You must make your final decision within ${stepsLeft} steps.` : `IMPORTANT: This is your last step. Make your final decision now.`}
${step > 0 && finishing ? `Finalize your decisions in this response by calling ${finishing} following the EXACT provided format.${notes ? ` Use \`${bashToolName}\` to save any notes you want to keep in this response.` : ''}` : ''}`;
  return reminder.split('\n').filter((line) => line).join(' ') || undefined;
}
