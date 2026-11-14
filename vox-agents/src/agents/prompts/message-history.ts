/**
 * @module agents/prompts/message-history
 *
 * Pure helpers that shrink a run's message history. With the seat `files` setting on, the step
 * loop (agents/runtime/vox-execute.ts) uses them to drop old workspace output once a request nears the
 * model's continuity threshold, or once after a context-length error. Every helper works on
 * copies and leaves its input untouched.
 */

import type { ModelMessage } from "ai";
import { bashToolName } from "../tools/tool-names.js";

/** Replaces the output of a bash result dropped by compaction. */
export const droppedOutputStub = 'Output dropped to save context. Re-run the command or read your workspace notes if you still need it.';

/** The one-time reminder sent when a run nears its compaction threshold. */
export const compactionReminder = 'IMPORTANT: Your context is filling up. Save anything you still need from earlier command output to your workspace now, because older output will soon be dropped.';

/**
 * Replaces the output of every bash tool result from `from` up to `keepFrom` with a short stub.
 * The calls and results themselves stay, so call/result pairs remain valid, and every other
 * message and tool result is returned as is. Messages before `from`, such as a cached initial
 * prompt carrying earlier traces, are untouched. Messages are copied only when a result changes.
 * @param messages - The run's message history
 * @param keepFrom - Index of the first message whose bash output is kept
 * @param from - Index of the first message whose bash output may be dropped
 */
export function compactWorkspaceTraffic(messages: ModelMessage[], keepFrom: number, from = 0): ModelMessage[] {
  return messages.map((message, index) => {
    if (index < from || index >= keepFrom || typeof message.content === 'string') return message;
    if (!message.content.some(isLiveBashResult)) return message;
    const content = message.content.map((part) =>
      isLiveBashResult(part) ? { ...part, output: { type: 'text' as const, value: droppedOutputStub } } : part);
    return { ...message, content } as ModelMessage;
  });
}

/** Whether a content part is a bash tool result whose output has not been stubbed yet. */
function isLiveBashResult(part: { type: string, toolName?: string, output?: unknown }): boolean {
  if (part.type !== 'tool-result' || part.toolName !== bashToolName) return false;
  const output = part.output as { type?: string, value?: unknown } | undefined;
  return !(output?.type === 'text' && output.value === droppedOutputStub);
}

/**
 * Removes reasoning parts from every assistant message from `from` on, except the most recent
 * assistant message, which some providers (Anthropic) need next to pending tool results. An
 * assistant message left with nothing is dropped. Messages before `from`, such as a cached
 * initial prompt, are untouched.
 * @param messages - The run's message history
 * @param from - Index of the first message that may lose its reasoning
 */
export function dropOlderReasoning(messages: ModelMessage[], from = 0): ModelMessage[] {
  let latest = messages.length - 1;
  while (latest >= 0 && messages[latest].role !== 'assistant') latest--;
  const result: ModelMessage[] = [];
  messages.forEach((message, index) => {
    if (index < from || index === latest || message.role !== 'assistant' || typeof message.content === 'string'
      || !message.content.some(isReasoningPart)) {
      result.push(message);
      return;
    }
    const content = message.content.filter((part) => !isReasoningPart(part));
    if (content.length > 0) result.push({ ...message, content });
  });
  return result;
}

/** Whether an assistant content part carries model reasoning. */
function isReasoningPart(part: { type: string }): boolean {
  return part.type === 'reasoning' || part.type === 'reasoning-file';
}
