/**
 * @module utils/diplomacy/transcript
 *
 * Write-through I/O between vox-agents' in-memory chat threads and the durable mcp-server
 * transcript store (interactive-diplomacy stages 1–2). For diplomacy conversations the store
 * is the source of truth: threads are hydrated from `read-transcript` on open and every
 * message is written through `append-message`.
 *
 * The pure reconciliation helpers (id derivation, role mapping, hydration, close-status) live
 * in `./transcript-utils.ts` and are re-exported here for convenience.
 */

import type { EnvoyThread } from "../../types/index.js";
import { mcpClient } from "../models/mcp-client.js";
import { hydrateMessages, deriveCloseTurn } from "./transcript-utils.js";
import type { TranscriptMessage } from "./transcript-utils.js";

export type { TranscriptMessage } from "./transcript-utils.js";
export {
  diplomacyThreadId,
  orderPair,
  roleOf,
  identityOf,
  voicedID,
  agentName,
  audienceID,
  speakerRole,
  hydrateMessages,
  deriveCloseTurn,
  isClosedThisTurn,
  joinAssistantText,
  collectSpokenReply,
  retryMessage,
} from "./transcript-utils.js";

/** Read the full ordered transcript between two endpoints from the mcp-server store. */
export async function readTranscript(playerAID: number, playerBID: number): Promise<TranscriptMessage[]> {
  const result = await mcpClient.callTool("read-transcript", {
    PlayerAID: playerAID,
    PlayerBID: playerBID,
  });
  const raw = result as Record<string, unknown>;
  const structured = (raw.structuredContent ?? raw) as Record<string, unknown>;
  const arr = structured?.messages as unknown;
  return Array.isArray(arr) ? (arr as TranscriptMessage[]) : [];
}

/**
 * Re-hydrate a diplomacy thread's in-memory message cache (and close status) from the durable
 * transcript — the source of truth. Deal-action endpoints and the diplomat's tools write deal
 * rows straight to the store, bypassing the cache; calling this at every read boundary (open,
 * refresh) keeps the thread the UI renders in sync with what was actually persisted, in append
 * order. The single place transcript→thread synchronization lives.
 */
export async function syncThreadMessages(thread: EnvoyThread): Promise<void> {
  const transcript = await readTranscript(thread.player1ID, thread.player2ID);
  thread.messages = hydrateMessages(transcript, thread.agent);
  thread.closeTurn = deriveCloseTurn(transcript);
}

/**
 * Append one archival message for `thread`'s endpoint pair via the mcp-server
 * `append-message` tool. We never send `Turn`, so the store stamps the authoritative
 * current server turn (`knowledgeManager.getTurn()`); a live agent's `parameters.turn` is a
 * decision-point snapshot that can be stale once a conversation outlives its pause (specs §8).
 *
 * @returns the server-stamped turn the row was recorded at (the value `read-transcript` will
 *          later report for it), or `undefined` if the response didn't include it.
 */
export async function appendTranscriptMessage(
  thread: EnvoyThread,
  speakerID: number,
  messageType: "text" | "close",
  content: string
): Promise<number | undefined> {
  const result = await mcpClient.callTool("append-message", {
    PlayerAID: thread.player1ID,
    PlayerBID: thread.player2ID,
    PlayerARole: thread.player1Role,
    PlayerBRole: thread.player2Role,
    SpeakerID: speakerID,
    MessageType: messageType,
    Content: content,
  });
  const raw = result as Record<string, unknown>;
  const row = (raw.structuredContent ?? raw) as { Turn?: unknown };
  return typeof row?.Turn === "number" ? row.Turn : undefined;
}

/**
 * Append a `close` special message and record the close turn on the thread so it is
 * immediately locked for the rest of the current turn. Shared by the diplomat's
 * close-conversation tool and the Web close control.
 *
 * The recorded turn is the **server-stamped** turn returned by `append-message` — the same
 * value `deriveCloseTurn` will read back on reopen — so the in-memory lock and the persisted
 * close turn can never diverge. `fallbackTurn` is used only if the response omits the turn.
 *
 * @returns the turn the close was recorded at
 */
export async function appendCloseMessage(
  thread: EnvoyThread,
  speakerID: number,
  content: string,
  fallbackTurn: number
): Promise<number> {
  const stampedTurn = await appendTranscriptMessage(thread, speakerID, "close", content);
  const turn = stampedTurn ?? fallbackTurn;
  thread.closeTurn = turn;
  return turn;
}
