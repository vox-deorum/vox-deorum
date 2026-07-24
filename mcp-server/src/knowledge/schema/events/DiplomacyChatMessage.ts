import { z } from 'zod';

/** Schema for one human chat message submitted from the in-game diplomacy panel. */
export const DiplomacyChatMessage = z.object({
  /** Effective caller seat. It may be a real observer slot outside the major-civilization range. */
  PlayerID: z.number(),
  /** LLM civilization whose assigned diplomat owns the conversation voice. */
  CounterpartID: z.number(),
  /** Source game turn, retained for validation and event history only. */
  Turn: z.number(),
  /** Panel text after the game-side delimiter sanitization. */
  Text: z.string().max(2000),
  /** Present only for a pure observer, never false. */
  AsObserver: z.literal(true).optional(),
});
