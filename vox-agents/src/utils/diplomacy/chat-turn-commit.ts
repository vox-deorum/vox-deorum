/**
 * @module utils/diplomacy/chat-turn-commit
 *
 * The commit/cleanup coordinator for one POST /agents/message turn over vox-agents' write-through
 * chat-thread cache. The mcp-server transcript store is append-only, so the caller's utterance is the
 * commit point; `beginChatTurn` is the single place that defines what "committed" means for a chat
 * turn — it serializes turns per thread, commits the caller, and hands back the success-archive and
 * lock-release/rollback steps — keeping the streaming route free to own only SSE/run orchestration.
 */

import type { EnvoyThread } from "../../types/index.js";
import { ModelMessage } from "ai";
import { appendTranscriptMessage, audienceID, joinAssistantText } from "./transcript.js";
import { createLogger } from "../logger.js";

const logger = createLogger("diplomacy:chat-turn-commit");

/** Triple-brace special tokens (e.g. {{{Greeting}}}) are agent triggers, not archival text. */
const SPECIAL_MESSAGE = /^\{\{\{.+\}\}\}$/;

/**
 * Thread ids with a chat turn currently committing/streaming. The cache is mutated by index
 * (push the caller row, slice/splice the reply), so two concurrent turns on one thread would
 * interleave those indices and delete each other's rows — at most one turn per thread at a time.
 */
const inFlight = new Set<string>();

/** Thrown by `beginChatTurn` when a turn is already in flight for the thread (the route maps it to 409). */
export class ThreadBusyError extends Error {
  constructor(threadId: string) {
    super(`A chat turn is already in progress for thread ${threadId}`);
    this.name = "ThreadBusyError";
  }
}

/** A committed, in-progress chat turn. Call `complete()` on success, then `finish()` in a `finally`. */
export interface ChatTurn {
  /** Archive the streamed reply (diplomacy only, best-effort) and mark the turn complete. */
  complete(): Promise<void>;
  /**
   * Release the per-thread lock and reconcile the cache with the store: a completed turn keeps both
   * rows; an incomplete one trims the unwritten reply (and a {{{Greeting}}} trigger's own cache row,
   * never a durable utterance) so the live view matches the append-only store. Idempotent — always
   * call it exactly once, in a `finally`.
   */
  finish(): void;
}

/**
 * Begin a chat turn: take the per-thread lock, then commit the caller utterance as the turn's commit
 * point — durably append it (a real diplomacy utterance, never a {{{Greeting}}} trigger) BEFORE the
 * run, so any proposal/close row the diplomat's tools write mid-run follows the message that prompted
 * it, then mirror it into the cache so the diplomat sees it and the live view renders it.
 *
 * Rejects with `ThreadBusyError` when a turn is already in flight for this thread, or with the
 * underlying store error when the durable append fails. In both cases nothing has streamed yet, so the
 * route can still send a non-2xx body and the UI can restore the never-sent message. The returned
 * handle owns the success archive (`complete`) and the lock-release + failure rollback (`finish`).
 */
export async function beginChatTurn(thread: EnvoyThread, message: string, turn: number): Promise<ChatTurn> {
  if (inFlight.has(thread.id)) throw new ThreadBusyError(thread.id);
  inFlight.add(thread.id);

  const isSpecial = SPECIAL_MESSAGE.test(message);
  try {
    if (thread.diplomacy && !isSpecial) {
      await appendTranscriptMessage(thread, audienceID(thread), "text", message);
    }
  } catch (error) {
    inFlight.delete(thread.id); // nothing committed — free the lock for a clean retry
    throw error;
  }

  // Mirror the committed caller into the cache; the assistant reply begins just past it.
  const userMessage: ModelMessage = { role: "user", content: message };
  thread.messages.push({ message: userMessage, metadata: { datetime: new Date(), turn } });
  thread.metadata!.updatedAt = new Date();
  const replyStart = thread.messages.length;

  let completed = false;
  let finished = false;
  return {
    async complete() {
      if (thread.diplomacy) {
        const reply = joinAssistantText(thread.messages.slice(replyStart));
        if (reply) {
          try {
            await appendTranscriptMessage(thread, thread.agent, "text", reply);
          } catch (error) {
            logger.error("Failed to append diplomat reply to transcript store", { error });
          }
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
