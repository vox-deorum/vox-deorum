/**
 * @module utils/prompts/closing-reminder
 *
 * The closing reminder appended as the last user message of each step (see
 * VoxAgent.continuationNudge). All of its wording lives here so it can be edited in one place.
 */

import { bashToolName, formatToolChoiceList } from '../tools/tool-names.js';

/**
 * Builds the single closing reminder appended to a step, in two paragraphs. Parts that do not
 * apply are left out, and a paragraph with no parts is dropped.
 * Tool rules:
 * - Requirement: the step's tool choice is required. It lives here rather than in the provider
 *   middleware's system text, so a step that drops to auto changes only the end of the prompt.
 * - Tool policy: the step was narrowed below the run's declared tools, which stay declared to the
 *   model, so it names what may actually run.
 * Decisions:
 * - Steps left: the run counts its steps down (files on).
 * - Finalize: from the second step on, asks for all decisions together in one response through the
 *   completion tools allowed on this step. With `notes` (bash may run and a workspace folder is
 *   writable), it asks the model to save notes with bash in that same response, since a finishing
 *   call ends the run and there is no subsequent step.
 * Returns undefined when no part applies.
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

  const rules = [
    required ? `IMPORTANT: You must call tools on this step, either to gather information or to act. Call every tool you need at once.` : '',
    !narrowed ? '' : tools ? `For this step, you may only call ${tools}; other tools will return an error.` : `No tools are available for this step. Write your response in plain text.`,
  ];
  const decisions = [
    stepsLeft === undefined ? '' : stepsLeft > 1 ? `IMPORTANT: You have ${stepsLeft} steps left to make your decisions.` : `IMPORTANT: This is your last step to make your decisions.`,
    step > 0 && finishing ? `Once you are ready, make all your decisions together in one response by calling ${finishing} following the EXACT provided format.` : '',
    step > 0 && finishing && notes ? `In that same response, use \`${bashToolName}\` to save any notes you want to keep, since finishing ends the run.` : '',
  ];
  return [rules, decisions]
    .map((parts) => parts.filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n\n') || undefined;
}
