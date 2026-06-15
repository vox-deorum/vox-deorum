/**
 * @module knowledge/schema
 *
 * Centralized re-export of all knowledge database schema types.
 * External consumers (e.g., vox-agents) import from this barrel
 * instead of reaching into individual schema files.
 */

// Base types
export type { KnowledgeDatabase, GameMetadata, MutableKnowledge, PlayerVisibility } from './base.js';
export { MaxMajorCivs } from './base.js';

// Timed/mutable entity types
export type { PlayerSummary, CityInformation, VictoryProgress, StrategyChange, FlavorChange, DiplomaticMessage } from './timed.js';

// Public (static) entity types
export type { PlayerInformation } from './public.js';
