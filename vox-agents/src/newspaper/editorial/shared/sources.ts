/** Shared stable deduplication for traceable editorial evidence sources. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';

/**
 * Remove repeated source references while keeping distinct tables and recorded row IDs.
 * First occurrence fixes the order, and the last object for a repeated identity wins.
 */
export function uniqueSources(sources: NewspaperSourceReference[]): NewspaperSourceReference[] {
  return [...new Map(sources.map((source) => [`${source.table}/${source.id}`, source])).values()];
}

/** Describe the actual recorded rows cited by an article for the evidence inspector. */
export function summarizeSources(sources: readonly NewspaperSourceReference[]): string {
  if (!sources.length) return 'No recorded rows cited.';
  let first = sources[0].turn;
  let last = first;
  for (const { turn } of sources) {
    first = Math.min(first, turn);
    last = Math.max(last, turn);
  }
  if (sources.length === 1) return `1 recorded row from turn ${first}.`;
  const period = first === last ? `turn ${first}` : `turns ${first} to ${last}`;
  return `${sources.length} recorded rows from ${period}.`;
}
