/**
 * @module agents/tools/tool-availability
 *
 * Post-hoc enforcement of a step's narrowed tool list. A run's declared tools stay declared to the
 * model on every step, so removing one mid-run never changes the cached prompt prefix. Instead, each
 * tool removed for the step gets an AI SDK `experimental_refineToolInput` entry that always fails: the SDK
 * marks only that call invalid, never executes it, and returns its error as a tool-error result.
 * Other calls in the same reply have no entry and execute normally.
 */

import { formatToolChoiceList } from "./tool-names.js";

/** A tool-name keyed map in the shape of `streamText`'s `experimental_refineToolInput`. */
export type ToolInputRejections = Record<string, (input: unknown) => never>;

/**
 * Builds one rejection entry per declared tool missing from `executable`. Returns undefined when
 * nothing was removed, so an unnarrowed step passes no hook at all.
 */
export function buildRemovedToolRejections(
  declared: string[],
  executable: string[],
): ToolInputRejections | undefined {
  const allowed = new Set(executable);
  const removed = declared.filter(name => !allowed.has(name));
  if (removed.length === 0) return undefined;

  const available = formatToolChoiceList(executable) ?? 'none';
  return Object.fromEntries(removed.map(name => [name, () => {
    throw new Error(`Tool \`${name}\` is not available for this step. Available tools: ${available}.`);
  }]));
}
