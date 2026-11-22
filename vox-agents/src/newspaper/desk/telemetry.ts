/** OpenTelemetry conventions for Writing Desk batches and their model calls. */
import type { Span } from '@opentelemetry/api';
import type { ModelMessage, StepResult, ToolSet } from 'ai';
import { stepTokenUsage, type StepTokenUsage } from '../../agents/telemetry/model-usage.js';

/** Dedicated telemetry context for the desk, which runs outside a game. */
export const deskTelemetryContextId = 'newspaper-desk-player-0';

/** Outcome of one model request, including what happened to the drafts it returned. */
export type DeskRequestOutcome = 'complete' | 'partial' | 'failed' | 'canceled' | 'discarded';

/** Build the messages that go to both the request trace and the model. */
export function deskMessages(prompt: string): ModelMessage[] {
  return [
    { role: 'system', content: prompt },
    { role: 'user', content: 'Write the requested choices now.' },
  ];
}

/** Keep the provider's reply before trimming fences or trying to parse JSON. */
export function recordDeskReply(span: Span, messages: ModelMessage[], step: StepResult<ToolSet>): StepTokenUsage | undefined {
  const response: ModelMessage[] = step.response?.messages?.length ? step.response.messages :
    typeof step.text === 'string' ? [{ role: 'assistant', content: [{ type: 'text', text: step.text }] }] : [];
  // Message parts can carry provider metadata as well as the messages themselves.
  if (response.length) span.setAttribute('step.responses', JSON.stringify(response, (key, value) =>
    key === 'providerOptions' || key === 'providerMetadata' ? undefined : value));
  return step.usage && stepTokenUsage(messages, step.usage, response);
}

const tokenAttributes = [
  ['inputTokens', 'tokens.input'],
  ['cachedInputTokens', 'tokens.input.cached'],
  ['outputTokens', 'tokens.output'],
  ['reasoningTokens', 'tokens.reasoning'],
] as const;

/** Set token counts that are known, preserving the difference between zero and unknown. */
export function recordDeskUsage(span: Span, usage: Partial<StepTokenUsage>): void {
  for (const [key, attribute] of tokenAttributes) {
    if (usage[key] !== undefined) span.setAttribute(attribute, usage[key]);
  }
}

/** Include one request's usage in its batch's token totals. */
export function sumDeskUsage(total: Partial<StepTokenUsage>, request: Partial<StepTokenUsage>): void {
  for (const [key] of tokenAttributes) {
    if (request[key] !== undefined) total[key] = (total[key] ?? 0) + request[key];
  }
}
