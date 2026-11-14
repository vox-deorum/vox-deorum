import { z } from 'zod';

/**
 * Event triggered when the barbarian civilization spawns a new unit
 */
export const BarbariansSpawnedUnit = z.object({
  /** The X coordinate of the plot where the barbarian unit was spawned */
  PlotX: z.number(),
  /** The Y coordinate of the plot where the barbarian unit was spawned */
  PlotY: z.number(),
  /** The internal unit type ID (UnitTypes enum) of the spawned barbarian unit */
  UnitType: z.number()
});