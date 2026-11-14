import { z } from 'zod';

/**
 * The UnitCaptured event is triggered when a unit is captured or converted by another player through various game mechanics.
 * This event encompasses multiple scenarios including combat capture, barbarian conversion through religious beliefs or traits, and special unit abilities.
 */
export const UnitCaptured = z.object({
  /** The ID of the player who captured/converted the unit */
  NewOwnerID: z.number(),
  /** The ID of the unit that performed the capture, or unit type if from capture definition */
  CapturingUnitID: z.number(),
  /** The ID of the player who originally owned the captured unit */
  OldOwnerID: z.number(),
  /** The unique identifier of the unit that was captured/converted */
  CapturedUnitID: z.number(),
  /** Whether the unit was killed instead of captured (true = killed, false = captured) */
  WasKilled: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  /** An integer indicating the type/context of capture (0=combat, 1=capture definition, 2=trait conversion, 3=trait barbarian conversion, 4=religious conversion) */
  CaptureType: z.number()
});