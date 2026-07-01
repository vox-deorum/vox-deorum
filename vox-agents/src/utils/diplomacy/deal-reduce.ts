/**
 * @module utils/diplomacy/deal-reduce
 *
 * Server-side reduction of a conversation's append-ordered deal messages into the latest
 * active proposal and its agreement status (interactive-diplomacy stage 5, work item 4).
 *
 * This is the single source of truth for deal-state reduction; the stage-4 UI reducer
 * (`ui/src/components/deal/deal-reduce.ts`) is a thin typed wrapper that delegates here (via the
 * `@vox` alias), so the two can never drift. The durable transcript is append-only and
 * status-free (specs §6), so the current deal state is *derived*, never stored. The diplomat (to
 * see the on-the-table deal), the negotiator loop (to forward it), and the orchestration layer
 * (to decide what to enact) all reduce here rather than guessing.
 *
 *  - `deal-proposal` / `deal-counter` replace the active deal (the latest on the table wins);
 *  - `deal-accept` / `deal-reject` / `deal-enacted` reference the proposal they answer via
 *    `Payload.ProposalMessageID`;
 *  - **agreement** exists only when the active proposal has the required acceptance from its
 *    recipient and no later counter/reject supersedes it; `deal-enacted` records that
 *    orchestration succeeded for that proposal (the in-game transfer itself lands in stage 6).
 */

import type { TranscriptMessage } from "./transcript-utils.js";
import type { DealPayload } from "../../../../mcp-server/dist/utils/deal-schema.js";

/** Lifecycle status of the latest active proposal, derived from the messages answering it. */
export type DealStatus = "none" | "open" | "rejected" | "accepted" | "enacted";

export interface DealReduction<M extends TranscriptMessage = TranscriptMessage> {
  /** The latest proposal/counter on the table, or null if none has been presented. */
  active: M | null;
  /** Status of the active proposal (`none` when there is no active proposal). */
  status: DealStatus;
  /**
   * The outward line the answering move recorded (the negotiator's voiced message on the
   * deal-accept / deal-reject that set the current status). Lets the UI surface that line in the
   * outcome notice, chiefly the rejected case, whose deal-reject row is not rendered on its own.
   */
  statusMessage?: string;
  /** All proposal/counter messages in append order (proposal history). */
  proposals: M[];
}

const PROPOSAL_TYPES = new Set(["deal-proposal", "deal-counter"]);

/** The `ProposalMessageID` a response message answers, if any. */
function answeredProposalID(message: TranscriptMessage): number | undefined {
  const id = (message.Payload as Record<string, unknown> | undefined)?.ProposalMessageID;
  return typeof id === "number" ? id : undefined;
}

/**
 * Reduce append-ordered deal messages into the latest active proposal and its status.
 * The active proposal is the most recent proposal/counter; its status comes from any later
 * message referencing its ID (enacted > accepted > rejected, else open). A proposal answered
 * only by responses to *earlier* proposals stays `open`.
 */
export function deriveActiveProposal<M extends TranscriptMessage>(messages: M[]): DealReduction<M> {
  const proposals = messages.filter((m) => PROPOSAL_TYPES.has(m.MessageType));
  const active = proposals.length > 0 ? proposals[proposals.length - 1]! : null;

  if (!active) {
    return { active: null, status: "none", proposals };
  }

  // `enacted` is terminal. Acceptance is sticky: once the recipient has accepted the active
  // proposal, a later `deal-reject` referencing the same proposal cannot demote it (the
  // `status === "open"` guard): the next move against an accepted deal is a fresh
  // counter/proposal, which supersedes it by becoming the new `active`. We track `enacted` rather
  // than returning early so the answering move's outward line (`statusMessage`) is captured first.
  let status: DealStatus = "open";
  let statusMessage: string | undefined;
  let enacted = false;
  for (const m of messages) {
    if (answeredProposalID(m) !== active.ID) continue;
    if (m.MessageType === "deal-enacted") {
      enacted = true;
    } else if (m.MessageType === "deal-accept") {
      status = "accepted";
      if (m.Content) statusMessage = m.Content;
    } else if (m.MessageType === "deal-reject" && status === "open") {
      status = "rejected";
      if (m.Content) statusMessage = m.Content;
    }
  }

  return { active, status: enacted ? "enacted" : status, proposals, statusMessage };
}

/** The active proposal's stored deal terms, or undefined when none is on the table. */
export function activeProposalDeal(reduction: DealReduction): DealPayload | undefined {
  const deal = (reduction.active?.Payload as Record<string, unknown> | undefined)?.Deal;
  return deal as DealPayload | undefined;
}

/** True when the conversation has reached a both-sides-agreed deal (accepted or enacted). */
export function isAgreed(reduction: DealReduction): boolean {
  return reduction.status === "accepted" || reduction.status === "enacted";
}

/**
 * True when an open proposal authored by the **counterpart** (not the agent's own seat) is on the
 * table. This is the one deal state that gates the diplomat's tools: when the ball is in its court
 * it should either hand the proposal to the negotiator or reply, not wander off into briefings. A
 * proposal our own side authored leaves the ball with the other side, so it does not restrict us.
 */
export function counterpartOpenProposal(reduction: DealReduction, agentSeat: number): boolean {
  return reduction.status === "open" && !!reduction.active && reduction.active.SpeakerID !== agentSeat;
}
