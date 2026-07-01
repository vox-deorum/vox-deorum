/**
 * @module utils/diplomacy/transcript-utils
 *
 * Pure helpers for reconciling vox-agents chat threads with the mcp-server transcript shape
 * (interactive-diplomacy stage 2). Kept free of I/O (no mcp-client) so they can be unit-tested
 * directly. The I/O wrappers live in `./transcript.ts`.
 *
 * Conventions (see EnvoyThread): the player pair is stored ordered by playerID
 * (`player1ID` = min, `player2ID` = max), mirroring the store; positions carry no
 * caller-vs-voiced meaning. `thread.agent` is the playerID of the agent-voiced seat, and
 * the audience is the other endpoint.
 */

import type { ModelMessage } from "ai";
import type { EnvoyThread, MessageWithMetadata, ParticipantIdentity } from "../../types/index.js";
// The canonical transcript/deal wire contracts are owned by mcp-server; re-export the row
// type so existing importers keep working, and reuse the shared deal-message guard.
import type { TranscriptMessage } from "../../../../mcp-server/dist/utils/transcript-schema.js";
import { isDealMessage, type DealTranscriptMessage } from "../../../../mcp-server/dist/utils/deal-schema.js";
import { sendMessageToolName } from "./send-message-tool-name.js";
export type { TranscriptMessage } from "../../../../mcp-server/dist/utils/transcript-schema.js";

/** Message types that contribute readable text to a conversation thread. */
const CONVERSATION_TYPES = new Set(["text", "close"]);

/**
 * Deterministic thread id for a diplomacy conversation: one conversation per ordered
 * player pair per game, so reopening the same pair hydrates the same thread rather than
 * minting a parallel one.
 */
export function diplomacyThreadId(gameID: string, playerA: number, playerB: number): string {
  const lo = Math.min(playerA, playerB);
  const hi = Math.max(playerA, playerB);
  return `dipl:${gameID}:${lo}:${hi}`;
}

/** Order a player pair the way the store does: Player1ID = min, Player2ID = max. */
export function orderPair(a: number, b: number): { player1ID: number; player2ID: number } {
  return { player1ID: Math.min(a, b), player2ID: Math.max(a, b) };
}

/** The free-form role descriptor stored for `id` in the ordered pair. */
export function roleOf(thread: EnvoyThread, id: number): string | undefined {
  return id === thread.player1ID ? thread.player1Role : thread.player2Role;
}

/** The civ/leader identity stored for `id` in the ordered pair, if any. */
export function identityOf(thread: EnvoyThread, id: number): ParticipantIdentity | undefined {
  return id === thread.player1ID ? thread.player1Identity : thread.player2Identity;
}

/** The agent-voiced (LLM) seat — the civ the agent speaks as. */
export function voicedID(thread: EnvoyThread): number {
  return thread.agent;
}

/** The executable VoxAgent name = the agent-voiced seat's role descriptor. */
export function agentName(thread: EnvoyThread): string | undefined {
  return roleOf(thread, thread.agent);
}

/** The other endpoint — whoever the agent is speaking to. */
export function audienceID(thread: EnvoyThread): number {
  return thread.player1ID === thread.agent ? thread.player2ID : thread.player1ID;
}

/**
 * Maps a transcript row's speaker to a chat role: the agent-voiced seat speaks as the
 * assistant; everyone else (the audience / observer) is the user.
 */
export function speakerRole(speakerID: number, voicedID: number): "assistant" | "user" {
  return speakerID === voicedID ? "assistant" : "user";
}

/**
 * Hydrate a single stored row into a thread cache item: a chat `message` + `metadata`, plus the
 * `deal` payload when it is a `deal-*` row (so the UI renders an inline deal card and reduces deal
 * state from it). The one place a transcript row becomes a cache item — used both for bulk
 * hydration and for mirroring a freshly-written deal row into the live cache.
 */
export function hydrateRow(m: TranscriptMessage, voicedID: number): MessageWithMetadata {
  const item: MessageWithMetadata = {
    message: { role: speakerRole(m.SpeakerID, voicedID), content: m.Content } as ModelMessage,
    // SQLite's unixepoch() stores whole seconds; JavaScript Date expects milliseconds.
    metadata: { datetime: new Date(m.CreatedAt * 1000), turn: m.Turn },
  };
  // The guard narrows `m` to DealTranscriptMessage — no cast needed.
  if (isDealMessage(m)) item.deal = m;
  return item;
}

/** Mirror a known deal row into a cache item (the row is already narrowed to a deal message). */
export function hydrateDealRow(row: DealTranscriptMessage, voicedID: number): MessageWithMetadata {
  return hydrateRow(row, voicedID);
}

/**
 * Hydrate a thread's in-memory message list from a stored transcript, in the store's append
 * order — the single source of truth for conversation ordering. Readable conversation
 * messages (`text`, `close`) and deal messages (`deal-*`) both become thread items; a deal
 * row additionally carries its payload on `deal`, so the UI renders an inline deal card and
 * reduces deal state from this same ordered list (no separate fetch or timestamp merge).
 */
export function hydrateMessages(transcript: TranscriptMessage[], voicedID: number): MessageWithMetadata[] {
  return transcript
    .filter((m) => CONVERSATION_TYPES.has(m.MessageType) || isDealMessage(m))
    .map((m) => hydrateRow(m, voicedID));
}

/**
 * Turn of the most recent `close` message in a transcript, or undefined if the
 * conversation is still open. vox-agents derives the open/closed status and the
 * same-turn resume lock from this (specs §8).
 */
export function deriveCloseTurn(transcript: TranscriptMessage[]): number | undefined {
  let closeTurn: number | undefined;
  for (const m of transcript) {
    if (m.MessageType === "close") closeTurn = m.Turn;
  }
  return closeTurn;
}

/**
 * A conversation is locked when its latest close was recorded on the current turn or later
 * (the counterpart cannot resume it until a later turn, specs §8).
 */
export function isClosedThisTurn(closeTurn: number | undefined, currentTurn: number): boolean {
  return closeTurn !== undefined && currentTurn <= closeTurn;
}

/** Concatenate the readable text of assistant messages, used to capture an LLM reply. */
export function joinAssistantText(messages: MessageWithMetadata[]): string {
  const parts: string[] = [];
  for (const item of messages) {
    if (item.message.role !== "assistant") continue;
    const content = item.message.content;
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text") parts.push(part.text);
      }
    }
  }
  return parts.join("\n").trim();
}

/**
 * The polite retry line streamed to the client and archived as the turn's reply when a turn ends
 * with no usable spoken reply (the step ceiling was hit, or the model produced nothing usable), so
 * a stuck turn degrades into a request to repeat rather than dead air. Shared by the commit path
 * and the web route so both stream/persist exactly the same line.
 */
export const retryMessage = "My apologies, I lost my train of thought. Could you say that again?";

/**
 * Capture exactly what was displayed as the agent's spoken reply. Walk assistant messages in
 * order and, within each, walk content parts in their original order, concatenating every `text`
 * part and every `send-message` tool-call part's `Message` input. That is the same sequence the
 * client rendered (native text-delta greetings/fallback interleaved with the `send-message` text
 * the streamer converted), so a reload reproduces the live view, closing the leak where a model
 * that narrates *and then* calls `send-message` would show both live but persist only the tool
 * text. Returns "" when nothing was spoken.
 *
 * Emptiness is detected with a trim check, but a non-empty reply is returned **verbatim** (not
 * trimmed): the streamed text preserves the model's own leading/trailing whitespace, so trimming
 * here would make the reloaded reply differ from what the counterpart saw live. Only the
 * newline join (display order) and the drop of empty pieces are imposed.
 *
 * `sendMessageOnly` (set for a live envoy, which speaks ONLY via `send-message`) drops raw assistant
 * `text` parts entirely, capturing just the `send-message` arguments. Raw free text in that mode is
 * the Anthropic tool-force fallback (possibly malformed tool-call junk): it is swallowed from the
 * live stream too, so excluding it here keeps live and reload identical and stores no junk.
 */
export function collectSpokenReply(
  messages: MessageWithMetadata[],
  opts?: { sendMessageOnly?: boolean }
): string {
  const sendMessageOnly = opts?.sendMessageOnly ?? false;
  const parts: string[] = [];
  for (const item of messages) {
    if (item.message.role !== "assistant") continue;
    const content = item.message.content;
    if (typeof content === "string") {
      if (!sendMessageOnly) parts.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text") {
          if (!sendMessageOnly) parts.push(part.text);
        } else if (part.type === "tool-call" && part.toolName === sendMessageToolName) {
          const message = (part.input as { Message?: unknown } | undefined)?.Message;
          if (typeof message === "string") parts.push(message);
        }
      }
    }
  }
  // Drop empty pieces (e.g. an empty text part that streamed nothing) so they add no phantom
  // separator, then collapse a whitespace-only turn to "" while leaving meaningful content untouched.
  const joined = parts.filter((piece) => piece !== "").join("\n");
  return joined.trim() === "" ? "" : joined;
}

/**
 * Completion tools whose call is itself the turn's visible outcome — a deal handoff or a closure —
 * even when the agent speaks no accompanying line. This is the single source of truth for the
 * diplomat's non-spoken terminal tools: `Diplomat.getCompletionTools()` is built from this set plus
 * `send-message` (speaking is captured by {@link collectSpokenReply}), so the two cannot drift.
 */
export const terminalActionTools = new Set(["call-negotiator", "close-conversation"]);

/**
 * Whether a reply slice contains a deliberate non-spoken outcome (a negotiator handoff or a
 * conversation close). Such a turn produced a deal move / close — shown to the counterpart in its
 * own right — so a missing spoken reply is intentional, NOT a stuck turn. The retry line (which
 * reads as "I lost my train of thought") must therefore stand in only when nothing was spoken AND
 * no terminal action was taken; otherwise it contradicts the deal/close the turn just produced.
 */
export function tookTerminalAction(messages: MessageWithMetadata[]): boolean {
  for (const item of messages) {
    if (item.message.role !== "assistant") continue;
    const content = item.message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === "tool-call" && terminalActionTools.has(part.toolName)) return true;
    }
  }
  return false;
}

/**
 * Whether a diplomacy turn's reply slice is a "stuck" turn that needs the {@link retryMessage}
 * stand-in: it spoke nothing ({@link collectSpokenReply} is empty) AND took no deliberate terminal
 * action ({@link tookTerminalAction} — a deal handoff or close is its own visible outcome). This is
 * the single decision behind the retry line: the commit path archives `retryMessage` and the web
 * route streams it under exactly this predicate, so both call this one function and can never drift
 * (e.g. a model whose spoken reply happens to equal `retryMessage` verbatim is NOT stuck — it spoke,
 * so this returns false and the route does not double the line the streamer already showed live).
 *
 * `sendMessageOnly` is forwarded to {@link collectSpokenReply} so the stuck-turn decision uses the
 * same reply definition the archive does, so for a live envoy free text does not count as "spoke".
 */
export function needsRetryReply(
  messages: MessageWithMetadata[],
  opts?: { sendMessageOnly?: boolean }
): boolean {
  return !collectSpokenReply(messages, opts) && !tookTerminalAction(messages);
}
