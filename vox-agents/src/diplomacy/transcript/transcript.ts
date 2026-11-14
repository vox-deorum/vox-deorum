/**
 * @module diplomacy/transcript/transcript
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
import { mcpClient } from "../../agents/mcp/mcp-client.js";
import { unwrapMcpResponse } from "../../agents/mcp/mcp-response.js";
import { hydrateMessages, deriveCloseTurn, carryOverTrace, boundaryIndex } from "./transcript-utils.js";
import { reportThreadRow } from "../turn/active-turn-state.js";
import { countTokens } from "../../agents/models/token-counter.js";
import type { TranscriptMessage, TranscriptPushMessage } from "./transcript-utils.js";

export type { TranscriptMessage, TranscriptPushMessage } from "./transcript-utils.js";
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
  isDealRow,
  insertDurableRows,
  joinAssistantText,
  collectSpokenReply,
  retryMessage,
  tookTerminalAction,
  needsRetryReply,
} from "./transcript-utils.js";

/** Read the full ordered transcript between two endpoints from the mcp-server store. */
export async function readTranscript(playerAID: number, playerBID: number): Promise<TranscriptMessage[]> {
  return (await readTranscriptPage(playerAID, playerBID)).messages;
}

/** A page of durable transcript rows plus its raw-store continuation metadata. */
export interface TranscriptPage {
  messages: TranscriptMessage[];
  hasMore: boolean;
  nextBeforeID?: number;
}

/** Read one durable transcript page without touching an in-memory chat thread. */
export async function readTranscriptPage(
  playerAID: number,
  playerBID: number,
  options: { beforeID?: number; limit?: number } = {},
): Promise<TranscriptPage> {
  const result = await mcpClient.callTool("read-transcript", {
    PlayerAID: playerAID,
    PlayerBID: playerBID,
    ...(options.beforeID !== undefined ? { BeforeID: options.beforeID } : {}),
    ...(options.limit !== undefined ? { Limit: options.limit } : {}),
  });
  const structured = unwrapMcpResponse(result, "read-transcript");
  const messages = Array.isArray(structured.messages) ? structured.messages as TranscriptMessage[] : [];
  return {
    messages,
    hasMore: structured.hasMore === true,
    ...(typeof structured.NextBeforeID === "number" ? { nextBeforeID: structured.NextBeforeID } : {}),
  };
}

/**
 * Re-hydrate a diplomacy thread's in-memory message cache (and close status) from the durable
 * transcript — the source of truth. Deal-action endpoints and the diplomat's tools write deal
 * rows straight to the store, bypassing the cache; calling this at every read boundary (open,
 * refresh) keeps the thread the UI renders in sync with what was actually persisted, in append
 * order. The single place transcript→thread synchronization lives.
 */
export async function syncThreadMessages(thread: EnvoyThread, opts?: { preserveTrace?: boolean }): Promise<void> {
  const transcript = await readTranscript(thread.player1ID, thread.player2ID);
  const previous = thread.messages;
  thread.messages = hydrateMessages(transcript, thread.agent);
  // The native trace lives ONLY in this cache (never in the store), so the wholesale replacement
  // above would silently wipe it mid-conversation (a UI refresh, a deal action); re-attach it onto
  // the matching rehydrated rows, best-effort, so caching survives a refresh between runs. Auto-
  // compaction opts OUT (preserveTrace: false), since its whole job is to shed that retained fat.
  if (opts?.preserveTrace ?? true) carryOverTrace(previous, thread.messages);
  thread.closeTurn = deriveCloseTurn(transcript);
}

/** Soft token ceiling for a diplomacy thread's ongoing (uncompacted) exchange before it auto-compacts. */
export const AUTO_COMPACT_TOKEN_LIMIT = 100_000;

/**
 * Fold the retained ongoing exchange back into the compiled past block ("auto-compaction"): re-sync
 * from the durable store WITHOUT carrying the native traces back over (so the retained fat is truly
 * shed, not just left inert), then advance the open mark to the last hydrated row, so the whole record
 * renders as the one stable past block on the next run. Shared by chat reopen and the
 * {@link maybeAutoCompact} token gate.
 */
export async function autoCompact(thread: EnvoyThread): Promise<void> {
  await syncThreadMessages(thread, { preserveTrace: false });
  thread.pastMessageID = thread.messages.at(-1)?.metadata.id;
}

/**
 * Auto-compact a diplomacy thread when its ongoing exchange (the rows after the open mark, INCLUDING
 * each row's retained native trace) is estimated to exceed `limit` tokens, keeping the replayed
 * prompt bounded across a long same-turn sitting. Must run BEFORE a run captures its reply boundary,
 * since {@link autoCompact}'s wholesale re-sync would otherwise invalidate that index. A cheap JSON
 * estimate is used because the shared token counter does not price tool-result / reasoning text.
 */
export async function maybeAutoCompact(thread: EnvoyThread, limit: number = AUTO_COMPACT_TOKEN_LIMIT): Promise<void> {
  if (!thread.diplomacy) return;
  const start = boundaryIndex(thread.messages, thread.pastMessageID);
  if (start >= thread.messages.length) return;
  const ongoing = thread.messages.slice(start);
  const estimate = countTokens(JSON.stringify(ongoing.map((m) => m.metadata.trace ?? m.message)));
  if (estimate > limit) await autoCompact(thread);
}

/** Append one text row and return the store's committed transcript projection for game transport. */
export async function appendTranscriptMessageRow(
  thread: EnvoyThread,
  speakerID: number,
  content: string,
  expectedGameID?: string,
): Promise<TranscriptPushMessage> {
  return appendCommittedRow(thread, speakerID, "text", content, expectedGameID);
}

/**
 * Append one archival row for `thread`'s endpoint pair via the mcp-server `append-message` tool and
 * return the store's committed projection of it. We never send `Turn`, so the store stamps the
 * authoritative current server turn (`knowledgeManager.getTurn()`); a live agent's `parameters.turn`
 * is a decision-point snapshot that can be stale once a conversation outlives its pause (specs §8).
 *
 * The echoed row is required, not best-effort: this helper reports the exact committed row to its
 * turn's capture and callers mirror that row's ID and turn into the live cache, so an append that
 * does not echo a usable row is a store-contract violation rather than a value to paper over.
 */
async function appendCommittedRow(
  thread: EnvoyThread,
  speakerID: number,
  messageType: "text" | "close",
  content: string,
  expectedGameID?: string,
): Promise<TranscriptPushMessage> {
  const result = await mcpClient.callTool("append-message", {
    PlayerAID: thread.player1ID,
    PlayerBID: thread.player2ID,
    PlayerARole: thread.player1Role,
    PlayerBRole: thread.player2Role,
    SpeakerID: speakerID,
    MessageType: messageType,
    Content: content,
    ...(expectedGameID !== undefined ? { ExpectedGameID: expectedGameID } : {}),
  });
  const row = unwrapMcpResponse(result, "append-message") as Partial<TranscriptPushMessage>;
  if (
    typeof row.ID !== "number"
    || typeof row.SpeakerID !== "number"
    || typeof row.MessageType !== "string"
    || typeof row.Turn !== "number"
    || typeof row.Content !== "string"
  ) {
    throw new Error("append-message did not return a committed transcript row.");
  }
  const committed = row as TranscriptPushMessage;
  reportThreadRow(thread, committed);
  return committed;
}

/**
 * Append a `close` special message and record the close turn on the thread so it is
 * immediately locked for the rest of the current turn. Reached only through `closeConversation`,
 * which every closing path goes through: the Web close control and the terminal reconciliation
 * that commits a close the diplomat staged mid-run.
 *
 * The recorded turn is the **server-stamped** turn returned by `append-message` — the same
 * value `deriveCloseTurn` will read back on reopen — so the in-memory lock and the persisted
 * close turn can never diverge.
 *
 * @returns the stamped turn and the exact committed `close` row
 */
export async function appendCloseMessage(
  thread: EnvoyThread,
  speakerID: number,
  content: string
): Promise<{ turn: number; row: TranscriptPushMessage }> {
  const row = await appendCommittedRow(thread, speakerID, "close", content);
  thread.closeTurn = row.Turn;
  return { turn: row.Turn, row };
}
