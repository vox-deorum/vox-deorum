/**
 * @module utils/prompts/reminders
 *
 * The single place that owns how a mid-run reminder is attached to a conversation. Two sites inject
 * one: the empty-response rescue (`VoxAgent.prepareStep`, which rewrites the message list) and the
 * continuation nudge (`executeAgentStep` in infra/vox-execute.ts, which runs after the step's active tools are
 * resolved). Both must follow the same "never repeat the reminder that is already last" policy, so
 * it lives here rather than being restated at each site.
 */

import type { ModelMessage } from "ai";

/**
 * Returns the conversation with `reminder` appended as a user message. A missing reminder, or one
 * already sitting last, leaves the list untouched — restating an instruction the model has not yet
 * had a chance to act on only spends tokens.
 *
 * Never mutates the input. The step loop keeps its own `messages` and adopts a step's version only
 * once that step succeeds, so appending in place would leak the reminder into the run's history even
 * when the model call throws.
 */
export function appendReminder(messages: ModelMessage[], reminder: string | undefined): ModelMessage[] {
  if (!reminder || messages[messages.length - 1]?.content === reminder) return messages;
  return [...messages, { role: 'user', content: reminder }];
}
