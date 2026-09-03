/** OpenTelemetry attributes for metadata reported by the managed Codex proxy. */

import type { Attributes } from '@opentelemetry/api';

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

/** Return model-step attributes for the Codex instruction sources, when present. */
export function codexResponseTelemetryAttributes(providerMetadata: unknown): Attributes {
  const sources = instructionSources(providerMetadata);
  return sources === undefined ? {} : { 'host.instruction_sources': sources };
}
