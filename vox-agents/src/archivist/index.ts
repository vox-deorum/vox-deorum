/**
 * @module archivist
 *
 * Barrel file re-exporting the public API of the archivist module.
 * External consumers should import from this file to decouple from internal structure.
 *
 * Only the handful of symbols consumed outside the feature are surfaced here (the batch
 * pipeline, retrieval internals, and utilities are imported directly from their source
 * modules — see console.ts and the pipeline/ tree).
 */

export { findEpisodes } from './retrieval/reader.js';
export { parseDiplomatics } from './utils/game-data.js';
export type { EpisodeQuery, EpisodeResult } from './query-types.js';
