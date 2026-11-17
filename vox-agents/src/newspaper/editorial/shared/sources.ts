/** Shared stable deduplication for traceable editorial evidence sources. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';

/**
 * Remove repeated source references while keeping distinct tables and recorded row IDs.
 * First occurrence fixes the order, and the last object for a repeated identity wins.
 */
export function uniqueSources(sources: NewspaperSourceReference[]): NewspaperSourceReference[] {
  return [...new Map(sources.map((source) => [`${source.table}/${source.id}`, source])).values()];
}
