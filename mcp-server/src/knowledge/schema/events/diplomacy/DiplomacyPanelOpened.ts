import { z } from 'zod';

/** Schema for a request to reflush one durable diplomacy transcript into the game panel. */
export const DiplomacyPanelOpened = z.object({
  /** Effective caller seat. It may be a real observer slot outside the major-civilization range. */
  PlayerID: z.number(),
  /** LLM civilization whose assigned diplomat owns the conversation voice. */
  CounterpartID: z.number(),
  /** Source game turn, retained for validation and event history only. */
  Turn: z.number(),
  /** Present only for a pure observer, never false. */
  AsObserver: z.literal(true).optional(),
});
