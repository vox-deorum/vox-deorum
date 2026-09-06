/** OpenTelemetry attributes for metadata reported by the managed Codex proxy. */

import type { Attributes } from '@opentelemetry/api';
import type { CodexThreadReuse } from '../models/providers/codex-response.js';

/** Return a record for an object value that can be safely inspected. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Return the provider-reported instruction paths without changing their text. */
function instructionSources(providerMetadata: unknown): string[] | undefined {
  const sources = asRecord(asRecord(providerMetadata)?.codex)?.instructionSources;
  if (!Array.isArray(sources) || !sources.every((source) => typeof source === 'string')) return undefined;
  return [...sources];
}

/** Return the provider-reported thread reuse outcome when it is a known value. */
function threadReuse(providerMetadata: unknown): CodexThreadReuse | undefined {
  const value = asRecord(asRecord(providerMetadata)?.codex)?.threadReuse;
  return value === 'reused' || value === 'tried_failed' || value === 'fresh' ? value : undefined;
}

/** Return model-step attributes for the Codex proxy's response extensions. */
export function codexResponseTelemetryAttributes(providerMetadata: unknown): Attributes {
  const sources = instructionSources(providerMetadata);
  const reuse = threadReuse(providerMetadata);
  return {
    ...(sources === undefined ? {} : { 'host.instruction_sources': sources }),
    ...(reuse === undefined ? {} : { 'host.thread_reuse': reuse }),
  };
}
