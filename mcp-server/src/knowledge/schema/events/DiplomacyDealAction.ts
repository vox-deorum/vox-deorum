import { z } from 'zod';

/** Schema for one in-game diplomacy deal action. */
export const DiplomacyDealAction = z.object({
  /** Effective caller seat. It may be a real observer slot outside the major-civilization range. */
  PlayerID: z.number(),
  /** LLM civilization whose assigned diplomat owns the conversation voice. */
  CounterpartID: z.number(),
  /** Source game turn, retained for validation and event history only. */
  Turn: z.number(),
  /** Requested deal transition. Detailed action validation belongs to vox-agents. */
  Action: z.enum(['propose', 'counter', 'accept', 'reject']),
  /** Optional DealPayload v1, required by the bridge for propose and counter actions. */
  Deal: z.any().optional(),
  /** Optional transcript proposal ID, required by the bridge for counter, accept, and reject actions. */
  ProposalMessageID: z.number().optional(),
  /** Optional accompanying human text. */
  Text: z.string().max(2000).optional(),
  /** Present only for a pure observer, never false. */
  AsObserver: z.literal(true).optional(),
});
