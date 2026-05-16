/**
 * @module strategist/seating-options
 *
 * Pure helper that builds the `SeatingStateManagerOptions` from a
 * `StrategistSessionConfig`. Shared by the strategist loop and by any caller
 * that needs to inspect the cycle without owning a session.
 */

import type { StrategistSessionConfig } from '../types/config.js';
import { validateRandomSeedsList } from '../utils/game/random-seeds.js';
import type { SeatingStateManagerOptions } from '../utils/game/seating/types.js';

export function buildSeatingManagerOptions(config: StrategistSessionConfig): SeatingStateManagerOptions {
  const configSlots = Object.keys(config.llmPlayers).map(Number);
  const seedSets = validateRandomSeedsList(config.randomSeeds);
  return {
    configName: config.name,
    configSlots,
    // For 'start' mode this matches `computePlayerCount` (max(playerIds)+1);
    // load/wait modes have no authoritative count at construction time, so we
    // use the same fallback the old `ensureSeatingClaim` used.
    totalSeats: configSlots.length > 0 ? Math.max(...configSlots) + 1 : 1,
    seedCount: seedSets.length,
    seedSets,
    randomizeSeating: config.randomizeSeating,
  };
}
