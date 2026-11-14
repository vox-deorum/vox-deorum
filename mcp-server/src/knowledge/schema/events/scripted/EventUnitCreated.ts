import { z } from 'zod';

/**
 * Schema for EventUnitCreated event
 * Triggered when a unit is created as a result of an event choice
 */
export const EventUnitCreated = z.object({
  /** The ID of the player who will receive the created unit */
  PlayerID: z.number(),
  
  /** The identifier of the event choice that triggered the unit creation */
  EventChoiceID: z.number(),
  
  /** Pointer to the created unit object cast as integer */
  UnitPointer: z.number()
});