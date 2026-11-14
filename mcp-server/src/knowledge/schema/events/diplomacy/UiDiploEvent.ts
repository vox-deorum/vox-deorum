import { z } from "zod";

/**
 * Triggered when diplomatic events are initiated from the user interface
 * and need to be processed by the game core
 */
export const UiDiploEvent = z.object({
  /** The type of diplomatic event (FromUIDiploEventTypes enumeration) */
  EventType: z.number(),
  /** The player involved in the diplomatic interaction */
  AIPlayerID: z.number(),
  /** First argument specific to the diplomatic event type */
  Arg1: z.number(),
  /** Second argument specific to the diplomatic event type */
  Arg2: z.number(),
});