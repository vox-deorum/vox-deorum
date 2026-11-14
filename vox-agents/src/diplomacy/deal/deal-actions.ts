/**
 * @module diplomacy/deal/deal-actions
 *
 * The transport-neutral answers to a standing offer: accept and reject/retract
 * (interactive-diplomacy stage 7.04 work item 1).
 *
 * These used to live inside the Express handlers in `web/chat/deal.ts`, tangled with request parsing
 * and status mapping. That was fine while the Web was the only client; it stopped being fine once the
 * in-game panel became a second one, because the interesting part is not the HTTP plumbing — it is
 * the diplomacy-thread guard, the live-turn/closed-this-turn gate, the per-thread lock, the
 * authoritative backend call, and the live-cache hydration. Forking that for the bridge would have
 * meant two subtly different definitions of "may this player accept this deal right now?".
 *
 * So the actions live here, take an already-opened `EnvoyThread`, and throw typed errors. Thread
 * *lookup* stays transport-specific: Express resolves a `chatId`, the in-game bridge opens the pair
 * with `openDiplomacyChat`. Each transport maps the same error types to its own vocabulary
 * (HTTP status classes for the Web, `Status{error}` for the game).
 *
 * This module deliberately lives under `diplomacy/` so both the game bridge and web handlers can call it.
 */

import type { EnvoyThread } from "../../types/index.js";
import { withThreadLock } from "../turn/chat-turn-commit.js";
import {
  appendDealReject,
  enactAgentDeal,
  requireCurrentOpenProposal,
} from "./deal.js";
import { closedThisTurnDealMessage, requireOpenConversationTurn } from "../turn/live-turn.js";
import { audienceID, insertDurableRows, type TranscriptPushMessage } from "../transcript/transcript-utils.js";

/** Outward line recorded with a rejection when the caller supplies none. */
export const defaultRejectContent = "The deal was rejected.";

/**
 * Thrown when a deal action targets a conversation that is not a diplomacy thread. A caller mistake
 * (an ordinary observer/telepathist chat has no endpoint pair and no deal state), so both transports
 * map it to their invalid-request class.
 */
export class NotDiplomacyThreadError extends Error {
  constructor(message = "Only diplomacy conversations support deal actions") {
    super(message);
    this.name = "NotDiplomacyThreadError";
  }
}

/** The durable outcome of one direct deal action. */
export interface DealActionResult {
  /**
   * The durable rows carrying the result, in append order. For accept that is the `deal-accept` plus
   * `deal-enacted` pair (or, when the deal was already enacted, the existing `deal-enacted`); for
   * reject the single `deal-reject` (new or existing). Callers push these straight to their client —
   * there is no post-action transcript query.
   */
  rows: TranscriptPushMessage[];
  /**
   * True when this call caused a real state transition; false when it merely acknowledged an outcome
   * a previous call already produced. Consumers use it to decide whether an outcome is worth
   * announcing (a native notification, say) — while still delivering `rows`, because an idempotent
   * acknowledgement must still resolve the client's pending action.
   */
  changed: boolean;
}

/** Reject a deal action aimed at a conversation that has no deal state. */
function requireDiplomacyThread(thread: EnvoyThread): void {
  if (!thread.diplomacy) throw new NotDiplomacyThreadError();
}

/**
 * Accept the open proposal on a conversation and enact it, as the thread's audience endpoint.
 *
 * The precheck under the lock still runs, because it fails fast with a precise message before the
 * enactment route touches the game. It is no longer load-bearing for correctness, though: the
 * authoritative decision belongs to `enact-agent-deal`'s single serialized transaction, which returns
 * a structured conflict if the proposal state moved between the precheck and the enactment. That is
 * why there is no catch-time re-probe here — a proposal-state race stays a typed
 * `ProposalConflictError`, and only genuine store/bridge/enactment failures propagate as errors.
 *
 * @throws {NotDiplomacyThreadError} the conversation has no deal state
 * @throws {LiveTurnUnavailableError} the live game turn is not available
 * @throws {ConversationClosedThisTurnError} the conversation was closed this turn
 * @throws {ThreadBusyError} a chat turn or another exclusive action owns the thread
 * @throws {ProposalConflictError} the proposal is no longer the open offer for this endpoint
 */
export async function acceptDealAction(
  thread: EnvoyThread,
  proposalMessageID: number
): Promise<DealActionResult> {
  requireDiplomacyThread(thread);
  requireOpenConversationTurn(thread, { closedMessage: closedThisTurnDealMessage });
  const accepterID = audienceID(thread);

  return withThreadLock(thread, async () => {
    await requireCurrentOpenProposal(thread, proposalMessageID, accepterID);
    const enact = await enactAgentDeal(proposalMessageID, { accepterID, thread });
    // Hydrate exactly what the route committed. `enactedRow` is present on the idempotent path too
    // (it is the row that already existed), so an acknowledgement still repairs a cache that never
    // saw the original enactment; `insertDurableRows` skips anything already mirrored.
    const rows = [enact.acceptRow, enact.enactedRow].filter(
      (row): row is NonNullable<typeof row> => !!row
    );
    insertDurableRows(thread, rows);
    thread.metadata!.updatedAt = new Date();
    return { rows, changed: enact.enacted };
  });
}

/**
 * Reject the referenced proposal as the thread's audience endpoint — a decline when the counterpart
 * authored it, a retraction when this endpoint did.
 *
 * There is no precheck: proposal state belongs to the durable backend. `reject-agent-deal` decides in
 * one serialized transaction whether this is a fresh rejection, a redundant repeat of one this
 * speaker already made (`changed: false`, with the existing row returned so the client's pending
 * action still resolves), or a conflict.
 *
 * @throws {NotDiplomacyThreadError} the conversation has no deal state
 * @throws {LiveTurnUnavailableError} the live game turn is not available
 * @throws {ConversationClosedThisTurnError} the conversation was closed this turn
 * @throws {ThreadBusyError} a chat turn or another exclusive action owns the thread
 * @throws {ProposalConflictError} the proposal was already answered, rejected by the other endpoint,
 *         superseded, or does not exist
 */
export async function rejectDealAction(
  thread: EnvoyThread,
  proposalMessageID: number,
  content?: string
): Promise<DealActionResult> {
  requireDiplomacyThread(thread);
  requireOpenConversationTurn(thread, { closedMessage: closedThisTurnDealMessage });
  const speakerID = audienceID(thread);
  const line = content?.trim() || defaultRejectContent;

  return withThreadLock(thread, async () => {
    const rejection = await appendDealReject(thread, speakerID, line, proposalMessageID);
    insertDurableRows(thread, [rejection.row]);
    thread.metadata!.updatedAt = new Date();
    return { rows: [rejection.row], changed: rejection.created };
  });
}
