/**
 * @module types/web-chat
 *
 * Shared dependency and transport contracts for the Web chat boundary.
 */

import type { CreateChatRequest, PlayerAssignment } from './api.js';
import type { EnvoyThread, ParticipantIdentity } from './chat.js';
import type { ModelSize } from './config.js';
import type { TranscriptPushMessage } from '../diplomacy/transcript/transcript-utils.js';
import type { DealTranscriptMessage } from '../../../mcp-server/dist/diplomacy/deals/deal-schema.js';

/** Refresh a diplomacy thread from its durable transcript. */
export type SyncDiplomacyThread = (thread: EnvoyThread) => Promise<void>;

/** Shut down a context owned by a database-backed thread. */
export type ShutdownThreadContext = (contextId: string) => Promise<void>;

/** Dependencies that keep cache ownership separate from transcript and context ownership. */
export interface ChatThreadStoreDependencies {
  syncDiplomacyThread: SyncDiplomacyThread;
  shutdownContext: ShutdownThreadContext;
}

/** The subset of an agent needed while validating a chat open request. */
export interface ChatAgentDescriptor {
  diplomacyOnly?: boolean;
  speaksOnlyViaSendMessage?: boolean;
  modelSize?: ModelSize;
}

/** A context created for a database-backed ordinary chat. */
export interface TelepathistChatContext {
  contextId: string;
  gameID: string;
  playerID: number;
  identity: ParticipantIdentity;
}

/** A participant before it is projected onto the canonical ordered pair. */
export interface OrderedParticipant {
  id: number;
  role: string;
  identity?: ParticipantIdentity;
}

/** Dependencies used by the Express-independent thread factory. */
export interface ChatThreadFactoryDependencies<TContext = unknown> {
  getContext: (contextId: string) => TContext | undefined;
  getAgent: (agentName: string) => ChatAgentDescriptor | undefined;
  getAssignments: () => Record<number, PlayerAssignment> | undefined;
  getThread: (threadId: string) => EnvoyThread | undefined;
  setThread: (thread: EnvoyThread) => void;
  /** Whether a chat turn or exclusive thread action currently owns the thread's cache. */
  isThreadBusy: (threadId: string) => boolean;
  compactThread: (thread: EnvoyThread) => Promise<void>;
  createOrdinaryThreadId: () => string;
  createDiplomacyThreadId: (gameID: string, player1ID: number, player2ID: number) => string;
  createTelepathistContext: (
    databasePath: string,
    threadId: string,
  ) => Promise<TelepathistChatContext>;
}

/** The open operations produced by a configured chat thread factory. */
export interface ChatThreadFactory {
  openDiplomacyChat: (request: CreateChatRequest) => Promise<EnvoyThread>;
  openOrdinaryChat: (request: CreateChatRequest) => Promise<EnvoyThread>;
}

/**
 * Data sent when a committed turn first opens its stream.
 *
 * `rows` is the transport-neutral row contract (stage 7.04): the durable caller row committed BEFORE
 * the model ran, and nothing else. The turn's later capture never records these IDs, so a row can
 * never appear both here and in a terminal event. The Web SSE adapter omits `rows` — the public Web
 * event contract is unchanged and `deal` remains its compatibility view of the same committed row —
 * while the in-game sink pushes `rows` straight to the panel.
 */
export interface ChatConnectedEvent {
  sessionId: string;
  deal?: DealTranscriptMessage;
  rows: TranscriptPushMessage[];
}

/** A text or model chunk emitted while the agent is running. */
export interface ChatMessageEvent {
  type: string;
  id?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  delta?: string;
  input?: unknown;
}

/**
 * Data sent when a committed turn fails after streaming has begun.
 *
 * `rows` carries any durable rows committed after `connected` but before the failure — an append-only
 * store cannot unwrite them, so the client must be told about them even though the turn failed.
 */
export interface ChatErrorEvent {
  message: string;
  rows: TranscriptPushMessage[];
}

/**
 * Data sent when a committed turn completes successfully.
 *
 * `rows` is every durable row committed after `connected`: the mid-run deal/close rows the diplomat's
 * tools wrote and the final archived reply, snapshotted once from the turn's frozen capture. `deals`
 * is the Web client's compatibility view, derived from those same rows — no second transcript read.
 */
export interface ChatDoneEvent {
  sessionId: string;
  messageCount: number;
  deals: DealTranscriptMessage[];
  rows: TranscriptPushMessage[];
}

/** Transport-neutral output surface for a chat turn. */
export interface ChatStreamSink {
  connected(data: ChatConnectedEvent): void;
  message(data: ChatMessageEvent): void;
  error(data: ChatErrorEvent): void;
  done(data: ChatDoneEvent): void;
  onDisconnect(callback: () => void): void;
}

/** A request rejected before the durable commit and before streaming starts. */
export interface ChatTurnRejection {
  status: number;
  error: string;
}
