/**
 * @module types/agents
 *
 * Chat-related types for Vox Agents.
 * Contains core agent definitions.
 */

import type { StreamTextOnChunkCallback, ToolSet } from "ai";

export interface StreamingEventCallback {
  OnChunk: StreamTextOnChunkCallback<ToolSet>
}
/**
 * @module envoy/envoy-thread
 *
 * Data structure for Envoy's chat thread input/output.
 * Contains the metadata and messages for a conversation thread.
 */

import type { ModelMessage } from "ai";

/**
 * Configuration for a special message type that triggers specific agent behavior.
 * Special messages are triple-brace-enclosed tokens (e.g., "{{{Greeting}}}") sent by the UI
 * to instruct the agent to produce a context-aware response without appearing as user text.
 */
export interface SpecialMessageConfig {
  /** The instruction prompt for this special message type */
  prompt: string;
}

/** Identity (civ + leader) of a conversation participant, resolved once when the thread opens. */
export interface ParticipantIdentity {
  /** Civilization name, e.g. "Germany". */
  name: string;
  /** Leader name, e.g. "Bismarck". May be empty when unknown. */
  leader: string;
}

/**
 * Represents a message with associated metadata.
 * Wraps a ModelMessage with additional context about when and where it was created.
 */
export interface MessageWithMetadata {
  /** The actual message content */
  message: ModelMessage;

  /** Metadata about this message */
  metadata: {
    /** When this message was created */
    datetime: Date;

    /** Game turn when this message was created */
    turn: number;
  };
}

/**
 * Represents a chat thread for the Envoy agent.
 *
 * The thread mirrors the mcp-server `DiplomaticMessage` transcript schema as closely as
 * possible (interactive-diplomacy stage 2): the player pair is stored **ordered by
 * `playerID`** (`player1ID = min`, `player2ID = max`) with free-form `player1Role` /
 * `player2Role` descriptors, exactly like the store. Positions carry no caller-vs-voiced or
 * human-vs-LLM meaning.
 *
 * `agent` is the **playerID of the agent-voiced (LLM) seat** — the civ an agent speaks *as*
 * and whose VoxContext is executed. That seat's role descriptor *is* the executable agent
 * name (the stage-1 pinned contract: "the agent name for an LLM-voiced side"), so the agent
 * name is `roleOf(thread, thread.agent)` and the audience is the other endpoint. `SpeakerID`
 * is per-message (resolved at send time), not thread state, so it is not stored here.
 *
 * Each seat's identity (civ/leader) is resolved once at open time and stored on the thread
 * (`player1Identity` / `player2Identity`) rather than re-fetched from live game state on every
 * prompt: civ/leader is effectively immutable for a game, the durable transcript store has no
 * civ column to hydrate from, and storing it keeps the thread self-describing for both the
 * prompt builders and the UI.
 */
export interface EnvoyThread {
  /** Unique identifier for this thread. For diplomacy threads this is the deterministic
   *  key `dipl:${gameID}:${min(playerID)}:${max(playerID)}` so reopen hydrates the same thread. */
  id: string;

  /** PlayerID of the agent-voiced (LLM) seat; its role descriptor is the executable agent name. */
  agent: number;

  /** Title of this thread */
  title?: string;

  /** Game ID this thread is associated with */
  gameID: string;

  /** Lower playerID of the pair (= min), mirroring the store's Player1ID. May be -1 (observer). */
  player1ID: number;

  /** Higher playerID of the pair (= max), mirroring the store's Player2ID. */
  player2ID: number;

  /** Free-form role descriptor for player1 (agent name for an LLM side, human role, or "observer"). */
  player1Role?: string;

  /** Free-form role descriptor for player2 (agent name for an LLM side, human role, or "observer"). */
  player2Role?: string;

  /** Civ/leader identity of player1, resolved at open time. Undefined for the observer seat. */
  player1Identity?: ParticipantIdentity;

  /** Civ/leader identity of player2, resolved at open time. Undefined for the observer seat. */
  player2Identity?: ParticipantIdentity;

  /** True when this is a civ↔civ diplomacy conversation (both endpoints are real seats). */
  diplomacy?: boolean;

  /** Type of context: live VoxContext or database */
  contextType: 'live' | 'database';

  /** VoxContext ID for live sessions. The voiced seat's context: `${gameID}-player-${agent}`. */
  contextId: string;

  /** Database file path for database sessions */
  databasePath?: string;

  /** The conversation messages in this thread with metadata */
  messages: MessageWithMetadata[];

  /** Turn of the latest `close` special message, if the conversation has been closed.
   *  vox-agents derives open/closed status (and the same-turn resume lock) from this. */
  closeTurn?: number;

  /** Optional metadata for the thread */
  metadata?: {
    /** When the thread was created */
    createdAt?: Date;

    /** When the thread was last updated */
    updatedAt?: Date;

    /** Current game turn when thread was last active */
    turn?: number;
  };
}