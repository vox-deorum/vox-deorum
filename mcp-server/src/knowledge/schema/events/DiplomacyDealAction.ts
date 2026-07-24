import { z } from 'zod';

/** Schema for one in-game diplomacy deal action. */
export const DiplomacyDealAction = z.object({
  /** Effective caller seat. It may be a real observer slot outside the major-civilization range. */
  PlayerID: z.number(),
  /** LLM civilization whose assigned diplomat owns the conversation voice. */
  CounterpartID: z.number(),
  /** Source game turn, retained for validation and event history only. */
  Turn: z.number(),
  /** Requested deal transition. Deal-content validation (term legality etc.) belongs to vox-agents. */
  Action: z.enum(['propose', 'counter', 'accept', 'reject']),
  /** DealPayload v1. Required for propose and counter actions. */
  Deal: z.any().optional(),
  /** Transcript proposal ID. Required for counter, accept, and reject actions. */
  ProposalMessageID: z.number().optional(),
  /** Optional accompanying human text. */
  Text: z.string().max(2000).optional(),
  /** Present only for a pure observer, never false. */
  AsObserver: z.literal(true).optional(),
}).superRefine((event, ctx) => {
  // Enforce the per-action field requirements here, at the archive boundary, so a
  // malformed panel event is rejected instead of being stored and broadcast.
  if ((event.Action === 'propose' || event.Action === 'counter') && event.Deal === undefined) {
    ctx.addIssue({ code: 'custom', path: ['Deal'], message: `Deal is required for ${event.Action} actions` });
  }
  if (event.Action !== 'propose' && event.ProposalMessageID === undefined) {
    ctx.addIssue({ code: 'custom', path: ['ProposalMessageID'], message: `ProposalMessageID is required for ${event.Action} actions` });
  }
});
