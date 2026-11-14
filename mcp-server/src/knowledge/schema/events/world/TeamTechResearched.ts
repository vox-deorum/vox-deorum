/**
 * @module knowledge/schema/events/world/TeamTechResearched
 * @description TeamTechResearched event schema
 */

import { z } from 'zod';

/**
 * TeamTechResearched event schema
 *
 * Triggered when a team completes technology research through the Lua scripting system.
 * In Civilization V, teams share technology progress, so this event affects all
 * civilizations on the same team.
 *
 * @example
 * ```typescript
 * import { TeamTechResearched } from './knowledge/schema/events/world/TeamTechResearched.js';
 *
 * // Validate event data
 * const eventData = TeamTechResearched.parse({
 *   TeamID: 0,
 *   TechID: 15,
 *   ChangeAmount: 1
 * });
 * ```
 */
export const TeamTechResearched = z.object({
  /** The team that completed the technology research */
  TeamID: z.number(),
  /** The technology type identifier that was researched */
  TechID: z.number(),
  /** The amount of change (typically 1 for research completion, could be negative for tech loss) */
  ChangeAmount: z.number()
});