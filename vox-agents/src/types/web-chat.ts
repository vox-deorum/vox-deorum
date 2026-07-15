/**
 * @module types/web-chat
 *
 * Shared dependency and transport contracts for the Web chat boundary.
 */

import type { CreateChatRequest, PlayerAssignment } from './api.js';
import type { EnvoyThread, ParticipantIdentity } from './chat.js';
import type { DealTranscriptMessage } from '../../../mcp-server/dist/utils/deal-schema.js';

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
  compactThread: (thread: EnvoyThread) => Promise<void>;
  createOrdinaryThreadId: () => string;
  createDiplomacyThreadId: (gameID: string, player1ID: number, player2ID: number) => string;
  createTelepathistContext: (databasePath: string) => Promise<TelepathistChatContext>;
}

/** The open operations produced by a configured chat thread factory. */
export interface ChatThreadFactory {
  openDiplomacyChat: (request: CreateChatRequest) => Promise<EnvoyThread>;
  openOrdinaryChat: (request: CreateChatRequest) => Promise<EnvoyThread>;
}

/** Data sent when a committed turn first opens its stream. */
export interface ChatConnectedEvent {
  sessionId: string;
  deal?: DealTranscriptMessage;
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

/** Data sent when a committed turn fails after streaming has begun. */
export interface ChatErrorEvent {
  message: string;
}

/** Data sent when a committed turn completes successfully. */
export interface ChatDoneEvent {
  sessionId: string;
  messageCount: number;
  deals: DealTranscriptMessage[];
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

/** The untrusted route input, including legacy text bodies that omit `kind`. */
export interface ChatTurnRequest {
  chatId?: string;
  kind?: 'text' | 'deal';
  message?: string;
  deal?: unknown;
  expectedProposalID?: unknown;
}
