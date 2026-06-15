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
import type { EnvoyThread, MessageWithMetadata } from "../../types/index.js";

/** One transcript row as returned by the mcp-server `read-transcript` tool. */
export interface TranscriptMessage {
  ID: number;
  Player1ID: number;
  Player2ID: number;
  Player1Role: string;
  Player2Role: string;
  SpeakerID: number;
  MessageType: string;
  Content: string;
  Payload: Record<string, unknown>;
  Turn: number;
  CreatedAt: number;
}

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
 * Hydrate a thread's in-memory message list from a stored transcript. Only readable
 * conversation messages (`text`, `close`) become thread messages; deal messages (added
 * in later stages) are reduced separately by the deal UI/agents.
 */
export function hydrateMessages(transcript: TranscriptMessage[], voicedID: number): MessageWithMetadata[] {
  return transcript
    .filter((m) => CONVERSATION_TYPES.has(m.MessageType))
    .map((m) => ({
      message: { role: speakerRole(m.SpeakerID, voicedID), content: m.Content } as ModelMessage,
      metadata: { datetime: new Date(m.CreatedAt), turn: m.Turn },
    }));
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

/** Concatenate the readable text of assistant messages — used to capture an LLM reply. */
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
