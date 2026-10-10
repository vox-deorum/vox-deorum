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
import type { EnvoyThread, MessageWithMetadata, ParticipantIdentity } from "../../../types/index.js";
// The canonical transcript/deal wire contracts are owned by mcp-server; re-export the row
// type so existing importers keep working, and reuse the shared deal-message guard.
import type { TranscriptMessage } from "../../../../../mcp-server/dist/utils/transcript-schema.js";
import { DEAL_MESSAGE_TYPES, type DealTranscriptMessage } from "../../../../../mcp-server/dist/utils/deal-schema.js";
import { sendMessageToolName } from "../constants.js";
export type { TranscriptMessage } from "../../../../../mcp-server/dist/utils/transcript-schema.js";

/** The display name used for an audience seat without a civilization identity. */
export const observerName = "Observer";

/**
 * The durable row fields every transport needs after a write commits: the identity the panel
 * deduplicates by, who spoke, what kind of row it is, its text, the server-stamped turn, and (for
 * deal rows) the payload that carries the terms/outcome. `CreatedAt` rides along when the store
 * echoed it, so a row hydrated straight into the live cache keeps its real timestamp.
 *
 * Every deal/transcript writer returns this projection, so a caller never has to reread the
 * transcript to learn what it just created (stage 7.04 work item 2). A full {@link TranscriptMessage}
 * is structurally assignable to it, so a read row and a freshly committed row flow through the same
 * code paths.
 */
export type TranscriptPushMessage =
  Pick<TranscriptMessage, "ID" | "SpeakerID" | "MessageType" | "Content" | "Turn">
  & Partial<Pick<TranscriptMessage, "Payload" | "CreatedAt">>;

/**
 * Expands a deal transcript row into the inline conversation line the chat record renders in place of
 * its bare stored Content, or undefined to keep that Content as-is. The diplomat supplies one (terms
 * for a proposal, the answered-proposal reference for a reject/accept); other envoys leave it unset.
 */
export type DealRowRenderer = (row: DealTranscriptMessage) => string | undefined;

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

/** A seat → civ-name resolver from the thread's stored identities ("Player <id>" fallback). */
export function civNameFor(thread: EnvoyThread): (playerID: number) => string {
  return (id: number) => identityOf(thread, id)?.name ?? `Player ${id}`;
}

/** Build the speaker label shared by prompt rendering and spoken-message archival. */
export function speakerLabel(thread: EnvoyThread, seat: number): string {
  const civ = identityOf(thread, seat)?.name?.trim();
  if (!civ) return seat === thread.agent ? `Player ${seat}` : observerName;
  const role = roleOf(thread, seat)?.trim();
  if (!role) return civ;
  return /^the\s/i.test(role) ? `${civ}, ${role}` : `${civ}, the ${role}`;
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
 * True when a durable row (read or freshly committed) is one of the `deal-*` types, i.e. it carries
 * deal terms or a deal outcome on its Payload. Typed over the projected {@link TranscriptPushMessage}
 * rather than the full row so a committed write's projection can be classified without a reread.
 */
export function isDealRow(row: Pick<TranscriptPushMessage, "MessageType">): boolean {
  return (DEAL_MESSAGE_TYPES as readonly string[]).includes(row.MessageType);
}

/**
 * Hydrate a durable row projection into a thread cache item: a chat `message` + `metadata`, plus the
 * `deal` payload when it is a `deal-*` row (so the UI renders an inline deal card and reduces deal
 * state from it). The one place a transcript row becomes a cache item — used for bulk hydration, for
 * the caller/reply rows a chat turn commits, and for mirroring a freshly-written deal row.
 *
 * A committed-write projection may omit `CreatedAt` (the store's exact unixepoch loads on the next
 * full re-hydrate), in which case the cache row is stamped now; the timestamp is display-only.
 */
export function hydrateRow(m: TranscriptPushMessage, voicedID: number): MessageWithMetadata {
  const item: MessageWithMetadata = {
    message: { role: speakerRole(m.SpeakerID, voicedID), content: m.Content } as ModelMessage,
    // SQLite's unixepoch() stores whole seconds; JavaScript Date expects milliseconds.
    // The durable row ID rides along so the prompt builder can split past/ongoing by the
    // monotonic store ID (EnvoyThread.pastMessageID) without any index bookkeeping.
    metadata: {
      datetime: typeof m.CreatedAt === "number" ? new Date(m.CreatedAt * 1000) : new Date(),
      turn: m.Turn,
      id: m.ID,
    },
  };
  // A deal row's cache item carries the row itself so the board reduces state from the same ordered
  // list it renders. Every deal-* projection this codebase produces is a full row (the store echoes
  // the canonical columns), so the narrowing cast is safe where the type only promises the projection.
  if (isDealRow(m)) item.deal = m as DealTranscriptMessage;
  return item;
}

/** Mirror a known deal row into a cache item (the row is already narrowed to a deal message). */
export function hydrateDealRow(row: DealTranscriptMessage, voicedID: number): MessageWithMetadata {
  return hydrateRow(row, voicedID);
}

/** The durable store IDs already mirrored into a thread's live message cache. */
export function cachedRowIDs(thread: EnvoyThread): Set<number> {
  const ids = new Set<number>();
  for (const item of thread.messages) {
    if (item.metadata.id !== undefined) ids.add(item.metadata.id);
    if (item.deal) ids.add(item.deal.ID);
  }
  return ids;
}

/**
 * Mirror durable rows that are not yet in a thread's live cache, in ascending store-ID order, at
 * `index` (default: the end). Rows already present by ID are skipped, so this is safe to call with a
 * turn's whole captured row set — including the caller/reply rows the commit path already placed.
 *
 * This is how a turn repairs its cache from what it actually committed instead of rereading the
 * transcript: on success the mid-run deal/close rows land at the reply boundary (ahead of the
 * normalized reply), and on failure every durable row survives the transient-output rollback.
 *
 * @returns the number of rows inserted
 */
export function insertDurableRows(
  thread: EnvoyThread,
  rows: TranscriptPushMessage[],
  index?: number
): number {
  const present = cachedRowIDs(thread);
  const missing = rows
    .filter((row) => !present.has(row.ID))
    .sort((left, right) => left.ID - right.ID);
  if (missing.length === 0) return 0;
  const items = missing.map((row) => hydrateRow(row, thread.agent));
  thread.messages.splice(index ?? thread.messages.length, 0, ...items);
  return items.length;
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
    .filter((m) => CONVERSATION_TYPES.has(m.MessageType) || isDealRow(m))
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
 * Best-effort carry-over of the memory-only trace across a wholesale re-hydration: each old row
 * carrying `metadata.trace` donates it to the first unconsumed new assistant row with the SAME
 * string content, in order. Content equality is reliable because the commit path normalizes the
 * cache row to exactly the archived text and hydration returns exactly that stored text; turns
 * deliberately do not participate (the store stamps its own turn, which can differ from the live
 * snapshot the cache row was created with). Mutates `newMessages` in place.
 *
 * The single in-order cursor means a donor whose content is absent from `newMessages` (the reply was
 * genuinely rewritten) stalls it, so every later donor silently keeps its trace dropped. That is
 * acceptable for a best-effort carry-over: the trace is memory-only and its loss only forgoes a
 * native-trajectory replay (the row still renders as plain text), so this never promises completeness.
 */
export function carryOverTrace(
  oldMessages: MessageWithMetadata[],
  newMessages: MessageWithMetadata[]
): void {
  const donors = oldMessages.filter(
    (m) => m.metadata.trace?.length && m.message.role === "assistant" && typeof m.message.content === "string"
  );
  if (donors.length === 0) return;
  let cursor = 0;
  for (const item of newMessages) {
    if (cursor >= donors.length) break;
    if (item.message.role !== "assistant" || typeof item.message.content !== "string") continue;
    const donor = donors[cursor];
    if (donor && item.message.content === donor.message.content) {
      item.metadata.trace = donor.metadata.trace;
      cursor++;
    }
  }
}

/**
 * Capture a reply slice's full native trajectory for byte-faithful replay on a later run:
 * the assistant reasoning/text/tool-call rows plus the paired tool-result rows the model actually
 * emitted, EXCLUDING the traffic that renders as its own artifact ({@link traceExcludedTools}: the
 * `send-message` call whose text IS the collapsed reply row, the deal/close handoffs shown as deal
 * cards, and the fire-and-forget analyst call). Kept get-briefing style tool calls ride along with
 * their results so the model re-reads what it fetched.
 *
 * Rows and parts are shallow-copied so the capture outlives the slice (the commit path splices it
 * away); `providerOptions` (e.g. Anthropic's thinking-block signature) ride by reference on the copy.
 * The model's raw free text is dropped — only a diplomacy turn captures a trace, so free text there
 * is the swallowed tool-force fallback the user never saw (see the diplomacy-voice contract on
 * {@link VoxAgent.speaksOnlyViaSendMessage}). A final pairing pass drops any orphaned tool_use / tool_result
 * so the captured array is always a provider-valid sequence; empty-text reasoning placeholders are
 * dropped.
 */
export function collectTrace(messages: MessageWithMetadata[]): ModelMessage[] {
  const droppedCallIds = new Set<string>();
  const rows: ModelMessage[] = [];

  for (const item of messages) {
    const message = item.message;
    if (message.role === "assistant") {
      // A raw free-text assistant row is the junk tool-force fallback, never part of the trajectory.
      if (typeof message.content === "string") continue;
      if (!Array.isArray(message.content)) continue;
      const kept = message.content
        .filter((part) => {
          if (part.type === "reasoning") return part.text.trim() !== "";
          if (part.type === "text") return false;
          if (part.type === "tool-call") {
            if (traceExcludedTools.has(part.toolName)) { droppedCallIds.add(part.toolCallId); return false; }
            return true;
          }
          return false; // file / other parts have no place in the replayed trajectory
        })
        .map((part) => ({ ...part }));
      if (kept.length) rows.push({ ...message, content: kept });
    } else if (message.role === "tool" && Array.isArray(message.content)) {
      const kept = message.content
        .filter((part) =>
          part.type === "tool-result" && !traceExcludedTools.has(part.toolName) && !droppedCallIds.has(part.toolCallId)
        )
        .map((part) => ({ ...part }));
      if (kept.length) rows.push({ ...message, content: kept });
    }
  }

  return dropOrphanToolParts(rows);
}

/**
 * Drop any tool_use with no surviving tool_result, and any tool_result with no surviving tool_use,
 * so the trace is a provider-valid paired sequence even if filtering split a pair. Rows emptied by
 * the drop are removed. Worst case a later run re-writes the cache once; never an invalid request.
 */
function dropOrphanToolParts(rows: ModelMessage[]): ModelMessage[] {
  const useIds = new Set<string>();
  const resultIds = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row.content)) continue;
    for (const part of row.content) {
      if (part.type === "tool-call") useIds.add(part.toolCallId);
      else if (part.type === "tool-result") resultIds.add(part.toolCallId);
    }
  }
  const paired: ModelMessage[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.content)) { paired.push(row); continue; }
    const kept = row.content.filter((part) => {
      if (part.type === "tool-call") return resultIds.has(part.toolCallId);
      if (part.type === "tool-result") return useIds.has(part.toolCallId);
      return true;
    });
    if (kept.length === 0) continue;
    paired.push(kept.length === row.content.length ? row : { ...row, content: kept } as ModelMessage);
  }
  return paired;
}

/**
 * Index of the first ongoing row in `messages` given the open mark: rows whose durable store id is
 * at or before `mark` (a contiguous, monotonic prefix) are the settled past; the first row with no
 * id or an id past the mark begins the ongoing exchange. With no mark, everything is ongoing (0).
 * The single source of truth for the past/ongoing split, shared by the prompt builder and the
 * auto-compaction token gate.
 */
export function boundaryIndex(messages: MessageWithMetadata[], mark: number | undefined): number {
  if (mark === undefined) return 0;
  let boundary = 0;
  while (boundary < messages.length) {
    const id = messages[boundary]?.metadata.id;
    if (id === undefined || id > mark) break;
    boundary++;
  }
  return boundary;
}

/**
 * Completion tools whose call is itself the turn's visible outcome — a deal handoff or a closure —
 * even when the agent speaks no accompanying line. This is the single source of truth for the
 * diplomat's non-spoken terminal tools: `Diplomat.completionTools` is built from this set plus
 * `send-message` (speaking is captured by {@link collectSpokenReply}), so the two cannot drift.
 */
export const terminalActionTools = new Set(["call-negotiator", "close-conversation"]);

/**
 * Tools whose call/result must NOT enter a captured {@link collectTrace} trajectory, because each is
 * already represented elsewhere: `send-message`'s argument IS the collapsed reply row, the terminal
 * deal/close handoffs render as their own durable deal cards, and `call-diplomatic-analyst` is a
 * fire-and-forget report to the leader (not counterpart-facing). Everything not listed here (e.g.
 * `get-briefing`, `get-diplomatic-events`) is kept, paired with its result. Flip an entry to change
 * the policy in one place.
 */
export const traceExcludedTools = new Set<string>([sendMessageToolName, "call-diplomatic-analyst", ...terminalActionTools]);

/**
 * Whether a reply slice contains a deliberate non-spoken outcome (a negotiator handoff or a
 * conversation close). Such a turn produced a deal move / close — shown to the counterpart in its
 * own right — so a missing spoken reply is intentional, NOT a stuck turn. The retry line (which
 * reads as "I lost my train of thought") must therefore stand in only when nothing was spoken AND
 * no terminal action was taken; otherwise it contradicts the deal/close the turn just produced.
 *
 * A terminal call whose execution errored does NOT count: the handoff or closure it stood for never
 * happened, so suppressing the stand-in reply on its account would end the turn on silence — no
 * spoken line, no deal, no close, nothing for the client to render. Only an explicit error result
 * disqualifies a call: one with no recorded result at all (an aborted step, a hand-built fixture) is
 * treated as having run. Most turns take no terminal action, so the second pass is reached only when
 * the first found a candidate.
 */
export function tookTerminalAction(messages: MessageWithMetadata[]): boolean {
  let candidates: Set<string> | undefined;
  for (const item of messages) {
    if (item.message.role !== "assistant") continue;
    const content = item.message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === "tool-call" && terminalActionTools.has(part.toolName)) {
        (candidates ??= new Set()).add(part.toolCallId);
      }
    }
  }
  if (!candidates) return false;
  for (const item of messages) {
    if (item.message.role !== "tool" || !Array.isArray(item.message.content)) continue;
    for (const part of item.message.content) {
      if (part.type === "tool-result" && part.output?.type?.startsWith("error")) {
        candidates.delete(part.toolCallId);
      }
    }
  }
  return candidates.size > 0;
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
 * Free text does not count as "spoke", so the stuck-turn decision uses the same reply definition the
 * archive does (see the diplomacy-voice contract on {@link VoxAgent.speaksOnlyViaSendMessage}).
 */
export function needsRetryReply(messages: MessageWithMetadata[]): boolean {
  return !collectSpokenReply(messages, { sendMessageOnly: true }) && !tookTerminalAction(messages);
}
