/**
 * @module agents/models/model-reference
 *
 * Parses and formats provider-qualified model references with optional reasoning effort.
 */

import type { Model, ReasoningEffort } from '../../types/index.js';
import { ReasoningEfforts } from '../../types/config.js';

/** The normalized parts of a model reference. */
export interface ModelReference {
  fullKey: string;
  provider: string;
  name: string;
  reasoningEffort?: ReasoningEffort;
}

/** Parses a model reference, preserving native names with unrecognized @ suffixes. */
export function parseModelReference(reference: string): ModelReference {
  const atIndex = reference.lastIndexOf('@');
  const suffix = atIndex === -1 ? undefined : reference.slice(atIndex + 1).toLowerCase();
  const reasoningEffort = suffix && (ReasoningEfforts as readonly string[]).includes(suffix)
    ? suffix as ReasoningEffort
    : undefined;
  const fullKey = atIndex !== -1 && (reasoningEffort || suffix === '') ? reference.slice(0, atIndex) : reference;
  const slashIndex = fullKey.indexOf('/');

  return {
    fullKey,
    provider: slashIndex === -1 ? fullKey : fullKey.slice(0, slashIndex),
    name: slashIndex === -1 ? fullKey : fullKey.slice(slashIndex + 1),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

/** Formats a resolved model for telemetry and replay references. */
export function formatModelReference(model: Model): string {
  const reasoningEffort = model.options?.reasoningEffort;
  return `${model.provider}/${model.name}${reasoningEffort ? `@${reasoningEffort}` : ''}`;
}
