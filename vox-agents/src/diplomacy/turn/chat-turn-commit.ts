/**
 * @module diplomacy/turn/chat-turn-commit
 *
 * The commit/cleanup coordinator for one POST /agents/message turn over vox-agents' write-through
 * chat-thread cache. The mcp-server transcript store is append-only, so the caller's utterance is the
 * commit point; `beginChatTurn` is the single place that defines what "committed" means for a chat
 * turn — it serializes turns per thread, commits the caller, and hands back the success-archive and
 * lock-release/rollback steps — keeping the streaming route free to own only SSE/run orchestration.
 */

import type { EnvoyThread, ChatMessageRequest } from "../../types/index.js";
import type { DealTranscriptMessage } from "../../../../mcp-server/dist/diplomacy/deals/deal-schema.js";
import { appendTranscriptMessageRow, audienceID, collectSpokenReply, retryMessage, needsRetryReply, maybeAutoCompact } from "../transcript/transcript.js";
import { collectTrace, hydrateDealRow, type TranscriptPushMessage } from "../transcript/transcript-utils.js";
import type { ModelMessage } from "ai";
import { appendDealProposal, classifyDealSubmission, closeConversation } from "../deal/deal.js";
import { beginTurnState } from "./active-turn-state.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("diplomacy:chat-turn");

/** Triple-brace special tokens (e.g. {{{Greeting}}}) are agent triggers, not archival text. */
const SPECIAL_MESSAGE = /^\{\{\{.+\}\}\}$/;

/**
 * The one public wording for "this thread already has a turn in flight". Shared by every transport
 * mapper (the Web pre-stream rejection, the Web deal/close routes, the in-game bridge) so the same
 * {@link ThreadBusyError} never reaches two clients phrased two different ways.
 */
export const threadBusyMessage =
  "A reply is already being generated for this conversation. Please wait for it to finish.";

/**
 * What a chat turn commits before the diplomat streams its reply: the wire request itself
 * (`ChatMessageRequest`) — a `kind`-discriminated text utterance or structured deal proposal/counter.
 * The route passes `req.body` straight in (its `chatId` is ignored here), so there's ONE shape
 * end-to-end. Both kinds go through the same per-thread lock and reply-archive/rollback lifecycle
 * (`beginChatTurn`); only the commit step differs.
 */
export type TurnCommit = ChatMessageRequest;

/**
 * Thread ids with a chat turn currently committing/streaming. The cache is mutated by index
 * (push the caller row, slice/splice the reply), so two concurrent turns on one thread would
 * interleave those indices and delete each other's rows — at most one turn per thread at a time.
 */
const inFlight = new Set<string>();

/** Test whether a chat turn or exclusive thread action currently owns this thread. */
export function isThreadBusy(threadId: string): boolean {
  return inFlight.has(threadId);
}

/** Thrown by `beginChatTurn` when a turn is already in flight for the thread (the route maps it to 409). */
export class ThreadBusyError extends Error {
  constructor(threadId: string) {
    super(`A chat turn is already in progress for thread ${threadId}`);
    this.name = "ThreadBusyError";
  }
}

/** A committed, in-progress chat turn. Call `complete()` on success, then `finish()` in a `finally`. */
export interface ChatTurn {
  /**
   * The durable caller row this turn committed before the model ran — the turn's whole pre-run phase,
   * reported to the client on `connected`. Undefined when the move was never archived: a
   * `{{{Greeting}}}` trigger (an agent trigger, not an utterance) or a non-diplomacy chat (no store).
   */
  callerRow?: TranscriptPushMessage;
  /**
   * For a deal turn, the authoritative committed row (real ID + value snapshots) — the same row as
   * {@link callerRow}, kept separately typed so the Web `connected` event can carry its deal payload
   * and the UI inserts the card without a reread/refresh. Undefined for text.
   */
  dealRow?: DealTranscriptMessage;
  /**
   * Remove transient model/tool traffic and mark the turn complete. A valid `send-message` call
   * already archived its own row during tool execution. When nothing spoke or acted, this appends the
   * shared retry row instead. Terminal reconciliation mirrors observed durable rows into the cache.
   *
   * Retry archival is not best-effort: if the store refuses that append this throws, so the caller can
   * report a failure instead of letting a streamed draft masquerade as a durable completed reply.
   *
   * Any close the diplomat staged mid-run is committed as the LAST step here — after the spoken reply
   * and the negotiator's nested writes — so this one function owns the whole close-last ordering rule
   * rather than leaving it to a transport's call order.
   */
  complete(): Promise<void>;
  /**
   * Freeze the row capture and return every durable row this turn committed after its caller row, in
   * append order. Idempotent: the frozen snapshot is what every later call returns.
   */
  terminalRows(): TranscriptPushMessage[];
  /** The durable reply row that should carry this turn's native model trace, if any. */
  traceTarget(): { rowID: number; trace: ModelMessage[] } | undefined;
  /**
   * Release the per-thread lock and its row capture, and reconcile the cache with the store: a
   * completed turn keeps both rows; an incomplete one trims the unwritten reply (and a {{{Greeting}}}
   * trigger's own cache row, never a durable utterance) so the live view matches the append-only
   * store. Idempotent — always call it exactly once, in a `finally`.
   */
  finish(): void;
}

/**
 * Begin a chat turn: take the per-thread lock, auto-compact the ongoing exchange if it has outgrown
 * the soft token ceiling (under the lock, so a concurrent turn can't re-sync the cache out from under
 * an in-flight one), then commit the caller's move as the turn's commit point — durably appended
 * BEFORE the run, so any proposal/close row the diplomat's tools write mid-run follows the move that
 * prompted it — then mirror it into the cache so the diplomat sees it and the live view renders it. The move is either a plain-text utterance (`{kind:'text'}`, never a
 * {{{Greeting}}} trigger) or a structured deal proposal/counter (`{kind:'deal'}`, which computes the
 * value snapshots + durations server-side via `appendDealProposal`).
 *
 * Rejects with `ThreadBusyError` when a turn is already in flight for this thread, or with the
 * underlying commit error (a store append failure, or — for a deal — an `IllegalDealError` /
 * inspect failure) when the commit fails. In every case nothing has streamed yet, so the route can
 * still send a non-2xx body and the UI can restore/roll back the never-sent move. The returned
 * handle owns terminal cleanup (`complete`) and the lock-release + failure rollback (`finish`).
 */
export async function beginChatTurn(thread: EnvoyThread, commit: TurnCommit, turn: number): Promise<ChatTurn> {
  if (inFlight.has(thread.id)) throw new ThreadBusyError(thread.id);
  inFlight.add(thread.id);

  // A deal commit always archives a row (no special-token bypass); only a text commit may be a
  // {{{Greeting}}} trigger that must not be durably appended (and whose cache row `finish` trims).
  const isSpecial = commit.kind === "text" && SPECIAL_MESSAGE.test(commit.message);
  let dealRow: DealTranscriptMessage | undefined;
  let callerRow: TranscriptPushMessage | undefined;
  try {
    // Bound the replayed prompt UNDER the lock, before committing this move or capturing the reply
    // boundary: if the ongoing exchange (retained native traces included) has outgrown the soft token
    // ceiling, fold it into the compiled past block now. autoCompact re-syncs thread.messages
    // wholesale, so this is the only safe point for it: running it here, inside the per-thread lock and
    // ahead of both the caller append and the replyStart capture, keeps a concurrent turn from
    // re-syncing the array out from under an in-flight one and invalidating its reply index. It stays
    // ahead of the caller append so this move remains part of the ongoing exchange, not the past block.
    // No-op for non-diplomacy threads and when under the ceiling.
    await maybeAutoCompact(thread);

    if (commit.kind === "deal") {
      // Proposing and countering are one action — submitting a deal. Under this per-thread lock, reconcile
      // the submission against the live offer state: the submitter's view (`expectedProposalID`, or
      // undefined for "none open") must match reality. That both yields the archival type (a counter when
      // it answers the open offer, a fresh proposal when none is open) AND stops a stale/fresh submission
      // from silently superseding an offer that opened under it, or a stale counter from reviving a dead
      // one. A mismatch throws ProposalConflictError → the route 409s; the check and the ensuing append
      // are atomic because both run under this lock.
      const messageType = await classifyDealSubmission(thread, commit.expectedProposalID);
      // The durable commit point for a deal turn: inspect, hard-legality-guard, snapshot values, stamp
      // durations, and append the deal-proposal/deal-counter. It returns the authoritative row.
      const result = await appendDealProposal(thread, audienceID(thread), messageType, commit.deal);
      dealRow = result.row;
      callerRow = result.row;
    } else if (thread.diplomacy && !isSpecial) {
      callerRow = await appendTranscriptMessageRow(thread, audienceID(thread), commit.message);
    }
  } catch (error) {
    inFlight.delete(thread.id); // nothing committed — free the lock for a clean retry/rollback
    throw error;
  }

  // Mirror the committed caller into the cache; the assistant reply begins just past it. A deal turn
  // pushes the authoritative committed row straight from the append (real ID + value snapshots — no
  // reread); a text turn pushes the user utterance carrying that row's durable ID and server-stamped
  // turn, so the cached row is identical to what a reload would hydrate and a later repair can
  // recognize it by ID. A {{{Greeting}}} trigger has no durable row, so its cache row carries neither
  // (and `finish` trims it if the turn doesn't complete).
  if (commit.kind === "deal") {
    thread.messages.push(hydrateDealRow(dealRow!, thread.agent));
  } else {
    thread.messages.push({
      message: { role: "user", content: commit.message },
      metadata: {
        datetime: new Date(),
        turn: callerRow?.Turn ?? turn,
        ...(callerRow ? { id: callerRow.ID } : {}),
      },
    });
  }
  thread.metadata!.updatedAt = new Date();
  const replyStart = thread.messages.length;

  // Everything committed from here on belongs to the post-run phase. The caller row is excluded by ID
  // so the two phases can never overlap, whatever a nested writer reports. Registering here (rather
  // than in the route) ties the capture's lifetime to the lock's: `finish` releases both.
  const turnState = beginTurnState(thread, {
    ignoreIDs: callerRow ? [callerRow.ID] : undefined,
  });

  let completed = false;
  let finished = false;
  let traceTarget: { rowID: number; trace: ModelMessage[] } | undefined;
  return {
    callerRow,
    dealRow,
    async complete() {
      if (thread.diplomacy) {
        const slice = thread.messages.slice(replyStart);
        // Raw free text is never the reply here (see VoxAgent.speaksOnlyViaSendMessage).
        const spoken = collectSpokenReply(slice, { sendMessageOnly: true });
        if (!spoken && needsRetryReply(slice)) {
          await appendTranscriptMessageRow(thread, thread.agent, retryMessage);
        }
        // The cache is deliberately left without reply rows until the turn state is frozen.
        // That shared done/error path restores exactly the rows that reached the append-only store.
        thread.messages.splice(replyStart);
        // The trace is the WHOLE turn's trajectory, so it is kept only when the turn has exactly one
        // spoken row to hang it on. The tool that committed that row named it; nothing is guessed.
        const rowID = turnState.soleSpokenRowID();
        if (spoken && rowID !== undefined) {
          const trace = collectTrace(slice);
          if (trace.length) traceTarget = { rowID, trace };
        }
        // Last durable write of the turn, by construction: the diplomat's close-conversation tool only
        // stages, so the close row lands after the spoken reply and the negotiator's nested writes. A
        // failure here is logged rather than thrown — the reply is already durable and visible, and
        // `closeConversation` retracts before it closes, so the conversation simply stays open (see
        // deal.ts). Rethrowing would strand a committed reply behind an error the client can't act on.
        const staged = turnState.takeStagedClose();
        if (staged) {
          try {
            await closeConversation(thread, staged.speakerID, staged.content);
          } catch (error) {
            logger.error("Failed to commit a staged conversation close after the reply", {
              threadId: thread.id,
              error,
            });
          }
        }
      }
      completed = true;
    },
    terminalRows: () => turnState.freeze(),
    traceTarget: () => traceTarget,
    finish() {
      if (finished) return;
      finished = true;
      // Idempotent, and a no-op on the normal path where the terminal event already froze it — but a
      // turn that returns without emitting one must still leave no registration behind.
      turnState.freeze();
      if (!completed) thread.messages.splice(isSpecial ? replyStart - 1 : replyStart);
      inFlight.delete(thread.id);
    },
  };
}

/**
 * Run an exclusive, non-streaming thread action under the SAME per-thread lock that chat turns take
 * (`beginChatTurn`), so a blocking status write — a deal reject/accept or a conversation close — can't
 * interleave with, or read a half-applied state from, a streaming turn's commit/reply (or a sibling
 * status write). The diplomat's own negotiator/close tools run inside the streaming turn that already
 * holds the lock, so this serializes the human-initiated status routes against them too.
 *
 * Throws `ThreadBusyError` (the route maps it to 409) when a turn or another exclusive action holds the
 * lock; otherwise runs `action` and releases the lock in a `finally`. The action's own mutations are
 * the only ones touching the thread for its duration.
 */
export async function withThreadLock<T>(thread: EnvoyThread, action: () => Promise<T>): Promise<T> {
  if (inFlight.has(thread.id)) throw new ThreadBusyError(thread.id);
  inFlight.add(thread.id);
  try {
    return await action();
  } finally {
    inFlight.delete(thread.id);
  }
}
