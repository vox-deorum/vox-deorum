/**
 * @module utils/diplomacy/chat-turn-commit
 *
 * The commit/cleanup coordinator for one POST /agents/message turn over vox-agents' write-through
 * chat-thread cache. The mcp-server transcript store is append-only, so the caller's utterance is the
 * commit point; `beginChatTurn` is the single place that defines what "committed" means for a chat
 * turn — it serializes turns per thread, commits the caller, and hands back the success-archive and
 * lock-release/rollback steps — keeping the streaming route free to own only SSE/run orchestration.
 */

import type { EnvoyThread, ChatMessageRequest } from "../../types/index.js";
import type { DealTranscriptMessage } from "../../../../mcp-server/dist/utils/deal-schema.js";
import { ModelMessage } from "ai";
import { appendTranscriptMessage, audienceID, collectSpokenReply, retryMessage, needsRetryReply, maybeAutoCompact } from "./transcript.js";
import { collectTrace, hydrateDealRow } from "./transcript-utils.js";
import { appendDealProposal, classifyDealSubmission } from "./deal.js";
import { createLogger } from "../logger.js";

const logger = createLogger("diplomacy:chat-turn-commit");

/** Triple-brace special tokens (e.g. {{{Greeting}}}) are agent triggers, not archival text. */
const SPECIAL_MESSAGE = /^\{\{\{.+\}\}\}$/;

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
   * For a deal turn, the authoritative committed row (real ID + value snapshots) — the route emits it
   * over the `connected` SSE event so the UI inserts it without a reread/refresh. Undefined for text.
   */
  dealRow?: DealTranscriptMessage;
  /**
   * Archive the streamed reply (diplomacy only, best-effort), normalize the cached reply slice to that
   * same archived content, and mark the turn complete. `sendMessageOnly` (set for a live envoy) archives
   * only the explicit `send-message` reply, dropping raw free text (the same text the route swallows from
   * the live stream), so live and reload agree.
   */
  complete(opts?: { sendMessageOnly?: boolean }): Promise<void>;
  /**
   * Release the per-thread lock and reconcile the cache with the store: a completed turn keeps both
   * rows; an incomplete one trims the unwritten reply (and a {{{Greeting}}} trigger's own cache row,
   * never a durable utterance) so the live view matches the append-only store. Idempotent — always
   * call it exactly once, in a `finally`.
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
 * handle owns the success archive (`complete`) and the lock-release + failure rollback (`finish`).
 */
export async function beginChatTurn(thread: EnvoyThread, commit: TurnCommit, turn: number): Promise<ChatTurn> {
  if (inFlight.has(thread.id)) throw new ThreadBusyError(thread.id);
  inFlight.add(thread.id);

  // A deal commit always archives a row (no special-token bypass); only a text commit may be a
  // {{{Greeting}}} trigger that must not be durably appended (and whose cache row `finish` trims).
  const isSpecial = commit.kind === "text" && SPECIAL_MESSAGE.test(commit.message);
  let dealRow: DealTranscriptMessage | undefined;
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
    } else if (thread.diplomacy && !isSpecial) {
      await appendTranscriptMessage(thread, audienceID(thread), "text", commit.message);
    }
  } catch (error) {
    inFlight.delete(thread.id); // nothing committed — free the lock for a clean retry/rollback
    throw error;
  }

  // Mirror the committed caller into the cache; the assistant reply begins just past it. A deal turn
  // pushes the authoritative committed row straight from the append (real ID + value snapshots — no
  // reread); a text turn pushes the user utterance (a {{{Greeting}}} trigger included, trimmed by
  // `finish` if the turn doesn't complete).
  if (commit.kind === "deal") {
    thread.messages.push(hydrateDealRow(dealRow!, thread.agent));
  } else {
    const userMessage: ModelMessage = { role: "user", content: commit.message };
    thread.messages.push({ message: userMessage, metadata: { datetime: new Date(), turn } });
  }
  thread.metadata!.updatedAt = new Date();
  const replyStart = thread.messages.length;

  let completed = false;
  let finished = false;
  return {
    dealRow,
    async complete(opts?: { sendMessageOnly?: boolean }) {
      if (thread.diplomacy) {
        // Archive exactly what was displayed: the spoken reply is the interleaved text plus send-message
        // arguments (collectSpokenReply). For a live envoy (`sendMessageOnly`) only the explicit
        // send-message reply is kept, since raw free text is the swallowed tool-force fallback, so
        // excluding it here keeps the archive identical to the live stream. A turn that spoke nothing
        // falls back to the shared retry line (the same one the web route streams, under the SAME
        // `needsRetryReply` predicate with the same option), UNLESS it took a deliberate terminal action
        // (a deal handoff or a close): that turn's outcome is the deal/close itself (archived by its own
        // tool), so a "lost my train of thought" line would contradict it (needsRetryReply is false).
        // Such a turn archives no reply row.
        const slice = thread.messages.slice(replyStart);
        const spoken = collectSpokenReply(slice, opts);
        const reply = spoken || (needsRetryReply(slice, opts) ? retryMessage : "");
        if (reply) {
          try {
            await appendTranscriptMessage(thread, thread.agent, "text", reply);
          } catch (error) {
            logger.error("Failed to append diplomat reply to transcript store", { error });
          }
        }
        // Normalize the cache to exactly what was archived. The run left the raw assistant messages in
        // the slice (free text, the send-message tool call, the negotiator/close handoff); for a live
        // envoy that raw text is the swallowed tool-force fallback the user never saw, and none of the
        // tool plumbing is durable. Replacing the slice with the single archived reply row (or nothing
        // when the turn spoke none) drops the unseen text the same way the store does, so a later turn
        // prompts on the same history a reload would hydrate rather than resurfacing malformed junk. The
        // route splices any mid-run deal rows in at this same boundary afterward, ahead of this reply,
        // matching the durable order.
        //
        // The run's full native trajectory is the one thing rescued from the discarded slice: it
        // rides the normalized reply row's metadata (vox-agents memory only, the durable append above
        // stays reply-text-only) so the next run's prompt replays exactly what the model emitted
        // (signed thinking, paired tool_use/tool_result), not a reconstruction. See collectTrace.
        // Retained ONLY for a genuine spoken reply: a stuck turn that fell back to the retry line
        // gathered nothing worth replaying, and its dead-end tool traffic must not anchor the cache.
        const trace = spoken ? collectTrace(slice, opts) : [];
        thread.messages.splice(replyStart);
        if (reply) {
          thread.messages.push({
            message: { role: "assistant", content: reply },
            metadata: { datetime: new Date(), turn, ...(trace.length ? { trace } : {}) },
          });
        }
      }
      completed = true;
    },
    finish() {
      if (finished) return;
      finished = true;
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
