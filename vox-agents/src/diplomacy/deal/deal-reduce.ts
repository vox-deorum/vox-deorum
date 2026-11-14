/**
 * @module diplomacy/deal/deal-reduce
 *
 * Server-side reduction of a conversation's append-ordered deal messages into the latest
 * active proposal and its agreement status (interactive-diplomacy stage 5, work item 4).
 *
 * This is the single source of truth for deal-state reduction. The UI imports it through the
 * `@vox` alias, while the in-game panel carries a small Lua port in
 * `civ5-mod/UI/Diplomacy/VoxDeorumDiploPanel.lua`; keep its reducer semantics synchronized with this file.
 * The durable transcript is append-only and
 * status-free (specs §6), so the current deal state is *derived*, never stored. The diplomat (to
 * see the on-the-table deal), the negotiator loop (to forward it), and the orchestration layer
 * (to decide what to enact) all reduce here rather than guessing.
 *
 *  - `deal-proposal` / `deal-counter` replace the active deal (the latest on the table wins);
 *  - `deal-accept` / `deal-reject` / `deal-enacted` reference the proposal they answer via
 *    `Payload.ProposalMessageID`;
 *  - **agreement** exists only when the active proposal has the required acceptance from its
 *    recipient and no later counter/reject supersedes it; `deal-enacted` records that the deal was
 *    enacted in-game for that proposal (its trade items transferred and promise commitments applied).
 */

import type { TranscriptMessage } from "../transcript/transcript-utils.js";
import type { DealPayload } from "../../../../mcp-server/dist/diplomacy/deals/deal-schema.js";

/** Lifecycle status of the latest active proposal, derived from the messages answering it. */
export type DealStatus = "none" | "open" | "rejected" | "accepted" | "enacted";

export interface DealReduction<M extends TranscriptMessage = TranscriptMessage> {
  /** The latest proposal/counter on the table, or null if none has been presented. */
  active: M | null;
  /** Status of the active proposal (`none` when there is no active proposal). */
  status: DealStatus;
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
  // counter/proposal, which supersedes it by becoming the new `active`. We track `enacted`
  // separately from `status` so an enacted deal keeps reporting its terminal state.
  let status: DealStatus = "open";
  let enacted = false;
  for (const m of messages) {
    if (answeredProposalID(m) !== active.ID) continue;
    if (m.MessageType === "deal-enacted") {
      enacted = true;
    } else if (m.MessageType === "deal-accept") {
      status = "accepted";
    } else if (m.MessageType === "deal-reject" && status === "open") {
      status = "rejected";
    }
  }

  return { active, status: enacted ? "enacted" : status, proposals };
}

/** One proposal's resolved lifecycle, for rendering. */
export interface ProposalOutcome<M extends TranscriptMessage = TranscriptMessage> {
  /** Status of this specific proposal (never `none` -- the proposal itself exists). */
  status: Exclude<DealStatus, "none">;
  /** The `deal-accept` / `deal-reject` / `deal-enacted` rows answering it, in append order. */
  responses: M[];
  /** True when a later proposal/counter has replaced it on the table. */
  superseded: boolean;
}

/**
 * Reduce the same messages into a per-proposal outcome map, keyed by proposal ID.
 *
 * `deriveActiveProposal` deliberately answers only for the latest proposal, because that is the one
 * question the negotiation control flow asks. Rendering needs a different answer: every card in the
 * transcript has its own resolved fate, and it keeps that fate after a newer proposal supersedes it.
 * Reading status off the active reduction instead made an accepted card silently revert to
 * "superseded" the moment the conversation moved on, which left its acceptance visible only in the
 * standalone outcome rows.
 *
 * Status rules are identical to `deriveActiveProposal`: `enacted` is terminal, and acceptance is
 * sticky against a later reject of the same proposal. Supersession is reported alongside the status
 * rather than replacing it, so callers can prefer a real outcome and fall back to "superseded" only
 * for a proposal that was never answered.
 *
 * This is display-only. Nothing in the accept/reject/enact write path should branch on it.
 */
export function deriveProposalOutcomes<M extends TranscriptMessage>(
  messages: M[],
): Map<number, ProposalOutcome<M>> {
  const outcomes = new Map<number, ProposalOutcome<M>>();
  const proposals = messages.filter((m) => PROPOSAL_TYPES.has(m.MessageType));
  const latestID = proposals.length > 0 ? proposals[proposals.length - 1]!.ID : undefined;

  for (const proposal of proposals) {
    outcomes.set(proposal.ID, {
      status: "open",
      responses: [],
      superseded: proposal.ID !== latestID,
    });
  }

  for (const m of messages) {
    const answered = answeredProposalID(m);
    if (answered === undefined) continue;
    const outcome = outcomes.get(answered);
    if (!outcome) continue;
    if (m.MessageType === "deal-enacted") {
      outcome.responses.push(m);
      outcome.status = "enacted";
    } else if (m.MessageType === "deal-accept") {
      outcome.responses.push(m);
      if (outcome.status !== "enacted") outcome.status = "accepted";
    } else if (m.MessageType === "deal-reject") {
      outcome.responses.push(m);
      if (outcome.status === "open") outcome.status = "rejected";
    }
  }

  return outcomes;
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
