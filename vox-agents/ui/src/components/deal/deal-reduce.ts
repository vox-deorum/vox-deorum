/**
 * Client-side reduction of a conversation's append-ordered deal messages into the latest
 * active proposal (interactive-diplomacy stage 4, work item 4).
 *
 * The durable transcript is append-only and status-free (specs §6): the current deal state
 * is *derived*, not stored. This pure reducer keeps the Web aligned with the append-only
 * store and avoids a separate deal-status API:
 *  - `deal-proposal` / `deal-counter` messages replace the active deal (the latest one on
 *    the table is the active proposal);
 *  - `deal-accept` / `deal-reject` / `deal-enacted` messages reference the proposal they
 *    answer via `Payload.ProposalMessageID`;
 *  - a `deal-enacted` marks successful orchestration for a proposal once stage 6 exists.
 *
 * Acceptance and enactment are not exercised in stage-4 preview, but the reducer already
 * understands their message types so the UI is forward-compatible with stages 5–6.
 */

import type { DealTranscriptMessage } from '@/utils/types';

/** Lifecycle status of the latest active proposal, derived from the messages that answer it. */
export type DealStatus = 'none' | 'open' | 'rejected' | 'accepted' | 'enacted';

export interface DealReduction {
  /** The latest proposal/counter on the table, or null if none has been presented. */
  active: DealTranscriptMessage | null;
  /** Status of the active proposal (`none` when there is no active proposal). */
  status: DealStatus;
  /** All proposal/counter messages in append order (proposal history). */
  proposals: DealTranscriptMessage[];
}

const PROPOSAL_TYPES = new Set(['deal-proposal', 'deal-counter']);

/**
 * Reduce append-ordered deal messages into the latest active proposal and its status.
 * The active proposal is the most recent proposal/counter; its status comes from any
 * later message referencing its ID (enacted > accepted > rejected, else open).
 */
export function deriveActiveProposal(messages: DealTranscriptMessage[]): DealReduction {
  const proposals = messages.filter((m) => PROPOSAL_TYPES.has(m.MessageType));
  const active = proposals.length > 0 ? proposals[proposals.length - 1]! : null;

  if (!active) {
    return { active: null, status: 'none', proposals };
  }

  // Responses that answer THIS proposal (by the proposal message ID they carry).
  let status: DealStatus = 'open';
  for (const m of messages) {
    if (m.Payload?.ProposalMessageID !== active.ID) continue;
    if (m.MessageType === 'deal-enacted') {
      return { active, status: 'enacted', proposals };
    }
    if (m.MessageType === 'deal-accept') {
      status = 'accepted';
    } else if (m.MessageType === 'deal-reject' && status === 'open') {
      status = 'rejected';
    }
  }

  return { active, status, proposals };
}
