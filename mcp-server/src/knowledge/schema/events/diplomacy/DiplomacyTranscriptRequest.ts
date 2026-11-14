import { z } from 'zod';

/** Schema for a request to prepend an older diplomacy transcript page in the game panel. */
export const DiplomacyTranscriptRequest = z.object({
  /** Effective caller seat. It may be a real observer slot outside the major-civilization range. */
  PlayerID: z.number(),
  /** LLM civilization whose assigned diplomat owns the conversation voice. */
  CounterpartID: z.number(),
  /** Source game turn, retained for validation and event history only. */
  Turn: z.number(),
  /** Exclusive append-ID cursor for older rows. */
  BeforeID: z.number(),
  /** Present only for a pure observer, never false. */
  AsObserver: z.literal(true).optional(),
});
