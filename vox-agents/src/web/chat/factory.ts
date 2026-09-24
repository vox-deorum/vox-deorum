/**
 * @module web/chat/factory
 *
 * Builds ordinary and diplomacy chat threads without depending on Express.
 */

import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { agentRegistry } from '../../infra/agent-registry.js';
import { contextRegistry } from '../../infra/context-registry.js';
import { VoxContext } from '../../infra/vox-context.js';
import { defaultDiplomat } from '../../strategist/seat-config.js';
import type { StrategistParameters } from '../../strategist/strategy-parameters.js';
import {
  createTelepathistParameters,
  type TelepathistParameters,
} from '../../telepathist/telepathist-parameters.js';
import type {
  ChatThreadFactory,
  ChatThreadFactoryDependencies,
  CreateChatRequest,
  EnvoyThread,
  OrderedParticipant,
  ParticipantIdentity,
  TelepathistChatContext,
} from '../../types/index.js';
import { isThreadBusy } from '../../utils/diplomacy/turn/chat-turn-commit.js';
import { autoCompact, diplomacyThreadId, identityOf } from '../../utils/diplomacy/transcript/transcript.js';
import {
  parseContextIdentifier,
  parseDatabaseIdentifier,
} from '../../utils/telemetry/identifier-parser.js';
import { VoxSpanExporter } from '../../utils/telemetry/vox-exporter.js';
import { createLogger } from '../../utils/logger.js';
import { ensureModelsResolved, selectModelReference } from '../../utils/models/resolution.js';
import {
  civIdentity,
  displayIdentity,
  getActiveAssignments,
  resolveHumanSeat,
} from './enrichment.js';
import { chatThreadStore } from './store.js';

const logger = createLogger('webui:chat-factory');

/** The observer endpoint sentinel shared with the diplomacy transcript store. */
const observerID = -1;

/** The one context source selected for an ordinary chat. */
type OrdinaryContextSource =
  | { type: 'live'; contextId: string }
  | { type: 'database'; databasePath: string };

/** A validation failure that the Express adapter can map to the existing HTTP response. */
export class ChatOpenError extends Error {
  /** Create a typed chat-open error with its HTTP status. */
  constructor(
    public readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = 'ChatOpenError';
  }
}

/** Require an ordinary chat to select one live context or one telemetry database. */
function resolveOrdinaryContextSource(
  contextId: string | undefined,
  databasePath: string | undefined,
): OrdinaryContextSource {
  if (contextId && !databasePath) return { type: 'live', contextId };
  if (databasePath && !contextId) return { type: 'database', databasePath };

  throw new ChatOpenError(
    400,
    'Exactly one of contextId or databasePath is required for an ordinary conversation',
  );
}

/** Project two participants onto the store's canonical ascending player order. */
export function orderParticipants(
  a: OrderedParticipant,
  b: OrderedParticipant,
): Pick<EnvoyThread, 'player1ID' | 'player2ID' | 'player1Role' | 'player2Role' | 'player1Identity' | 'player2Identity'> {
  const [player1, player2] = a.id <= b.id ? [a, b] : [b, a];
  return {
    player1ID: player1.id,
    player2ID: player2.id,
    player1Role: player1.role,
    player2Role: player2.role,
    player1Identity: player1.identity,
    player2Identity: player2.identity,
  };
}

/** Build chat-open operations around explicit lookup, persistence, and context seams. */
export function createChatThreadFactory(
  dependencies: ChatThreadFactoryDependencies<VoxContext<StrategistParameters>>,
): ChatThreadFactory {
  /** Open or reopen the deterministic diplomacy thread for a player pair. */
  async function openDiplomacyChat(request: CreateChatRequest): Promise<EnvoyThread> {
    const {
      contextId,
      targetPlayerID,
      targetIdentity: sentTargetIdentity,
      callerPlayerID,
      callerIdentity: sentCallerIdentity,
      callerRole,
      agentName: agentOverride,
      turn,
    } = request;

    if (!contextId) {
      throw new ChatOpenError(400, 'contextId is required to resolve the game for a diplomacy conversation');
    }
    if (targetPlayerID === undefined) {
      throw new ChatOpenError(400, 'targetPlayerID (the LLM-voiced seat) is required');
    }

    const { gameID } = parseContextIdentifier(contextId);
    const assignments = dependencies.getAssignments();
    const initiatorID = callerPlayerID ?? resolveHumanSeat(assignments);
    if (initiatorID === undefined) {
      throw new ChatOpenError(400, 'callerPlayerID is required (no human-control seat to default to)');
    }
    if (initiatorID === targetPlayerID) {
      throw new ChatOpenError(400, 'A civilization cannot hold a conversation with itself');
    }

    const targetContextId = `${gameID}-player-${targetPlayerID}`;
    const targetContext = dependencies.getContext(targetContextId);
    if (!targetContext) {
      throw new ChatOpenError(400, `Target seat context not active: ${targetContextId}`);
    }

    const voice = agentOverride ?? assignments?.[targetPlayerID]?.diplomat ?? defaultDiplomat;
    const voiceAgent = dependencies.getAgent(voice);
    if (!voiceAgent) {
      throw new ChatOpenError(404, `Agent ${voice} not found`);
    }
    // The archival invariant every diplomacy turn downstream relies on: a voice that can answer as
    // raw free text would produce replies the transcript never sees, so it is refused here rather
    // than handled as a per-turn special case (see VoxAgent.speaksOnlyViaSendMessage).
    if (!voiceAgent.speaksOnlyViaSendMessage) {
      throw new ChatOpenError(
        400,
        `Agent ${voice} cannot voice diplomacy because it does not require the send-message tool.`,
      );
    }

    const audienceRole = callerRole?.trim() || 'the leader';
    const id = dependencies.createDiplomacyThreadId(gameID, initiatorID, targetPlayerID);
    const existing = dependencies.getThread(id);
    // A reopen must never erase a known identity: live resolution fails whenever the seat context
    // has no cached game state yet (fresh launch, load, crash recovery), so fall back to what the
    // existing thread already holds (the deterministic ID guarantees it is the same ordered pair).
    const targetIdentity = sentTargetIdentity
      ?? civIdentity(targetContext, targetPlayerID)
      ?? (existing && identityOf(existing, targetPlayerID));
    const initiatorIdentity = sentCallerIdentity
      ?? civIdentity(targetContext, initiatorID)
      ?? (existing && identityOf(existing, initiatorID));
    const targetCiv = displayIdentity(targetIdentity);
    const initiatorCiv = displayIdentity(initiatorIdentity);
    const ordered = orderParticipants(
      { id: targetPlayerID, role: voice, identity: targetIdentity },
      { id: initiatorID, role: audienceRole, identity: initiatorIdentity },
    );

    if (existing) {
      // A live turn owns this thread's message cache: it committed the caller row, captured the index
      // the reply begins at, and will splice that slice on completion. Reassigning the voice or
      // compacting here would replace `thread.messages` wholesale underneath it, invalidating that
      // index and dropping rows the turn is about to normalize. So a reopen during a live turn hands
      // back the existing thread untouched — no participant metadata, agent/context assignment, title,
      // timestamp, message, or compaction change. Both clients benefit: a Web reopen can no longer
      // corrupt an in-flight turn, and the in-game bridge sees the same live thread its `Begin.busy`
      // reports. Whatever the reopen wanted to change is applied by the next reopen, once the turn ends.
      if (dependencies.isThreadBusy(existing.id)) return existing;

      existing.agent = targetPlayerID;
      existing.contextId = targetContextId;
      existing.title = `${initiatorCiv ?? `Player ${initiatorID}`} ↔ ${targetCiv ?? `Player ${targetPlayerID}`}`;
      Object.assign(existing, ordered);
      await dependencies.compactThread(existing);
      existing.metadata!.updatedAt = new Date();
      return existing;
    }

    const thread: EnvoyThread = {
      id,
      agent: targetPlayerID,
      title: `${initiatorCiv ?? `Player ${initiatorID}`} ↔ ${targetCiv ?? `Player ${targetPlayerID}`}`,
      gameID,
      ...ordered,
      diplomacy: true,
      contextType: 'live',
      contextId: targetContextId,
      messages: [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        turn,
      },
    };

    await dependencies.compactThread(thread);
    dependencies.setThread(thread);
    return thread;
  }

  /** Open a new in-memory observer or database-backed telepathist thread. */
  async function openOrdinaryChat(request: CreateChatRequest): Promise<EnvoyThread> {
    const {
      agentName: requestedAgentName,
      contextId,
      databasePath,
      turn,
      callerRole,
      callerPlayerID,
      callerIdentity: sentCallerIdentity,
    } = request;

    if (!requestedAgentName) {
      throw new ChatOpenError(400, 'Agent name is required');
    }

    const agent = dependencies.getAgent(requestedAgentName);
    if (!agent) {
      throw new ChatOpenError(404, `Agent ${requestedAgentName} not found`);
    }
    if (agent.diplomacyOnly) {
      throw new ChatOpenError(
        400,
        `Agent ${requestedAgentName} only supports diplomacy mode; open it with mode: 'diplomacy'.`,
      );
    }

    const source = resolveOrdinaryContextSource(contextId, databasePath);
    const id = dependencies.createOrdinaryThreadId();
    let gameID = 'unknown';
    let voicedID = 0;
    let effectiveContextId: string;
    let voicedIdentity: ParticipantIdentity | undefined;

    if (source.type === 'live') {
      const existingContext = dependencies.getContext(source.contextId);
      if (!existingContext) {
        throw new ChatOpenError(400, `Connection not found: ${source.contextId}`);
      }

      effectiveContextId = source.contextId;
      logger.info(`Using existing VoxContext: ${source.contextId}`);
      const identifier = parseContextIdentifier(source.contextId);
      gameID = identifier.gameID;
      voicedID = identifier.playerID;
      voicedIdentity = civIdentity(existingContext, voicedID);
    } else {
      // Preflight failures are model-configuration errors (alias cycles, dangling aliases,
      // unknown models), not database failures: surface their actionable message instead of
      // the database-initialization label below.
      try {
        await ensureModelsResolved([selectModelReference(requestedAgentName, agent.modelSize)]);
      } catch (error) {
        throw new ChatOpenError(400, error instanceof Error ? error.message : String(error));
      }
      try {
        const telepathist = await dependencies.createTelepathistContext(source.databasePath, id);
        effectiveContextId = telepathist.contextId;
        gameID = telepathist.gameID;
        voicedID = telepathist.playerID;
        voicedIdentity = telepathist.identity;
        logger.info(`Created new VoxContext for telepathist mode: ${effectiveContextId}`);
      } catch (error) {
        logger.error('Failed to create telepathist context', { error });
        throw new ChatOpenError(400, `Failed to initialize database: ${source.databasePath}`);
      }
    }

    const callerID = callerPlayerID !== undefined && callerPlayerID >= 0
      ? callerPlayerID
      : observerID;
    const audienceRole = callerRole?.trim() || 'Observer';
    const callerIdentity = sentCallerIdentity
      ?? (callerID >= 0
        ? civIdentity(dependencies.getContext(effectiveContextId), callerID)
        : undefined);
    const ordered = orderParticipants(
      { id: voicedID, role: requestedAgentName, identity: voicedIdentity },
      { id: callerID, role: audienceRole, identity: callerIdentity },
    );
    const thread: EnvoyThread = {
      id,
      agent: voicedID,
      title: `${requestedAgentName} - ${new Date().toLocaleString()}`,
      gameID,
      ...ordered,
      diplomacy: false,
      contextType: source.type,
      contextId: effectiveContextId,
      databasePath: source.type === 'database' ? source.databasePath : undefined,
      messages: [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        turn,
      },
    };

    dependencies.setThread(thread);
    return thread;
  }

  return { openDiplomacyChat, openOrdinaryChat };
}

/** Create and initialize the production context for a database-backed chat. */
async function createProductionTelepathistContext(
  databasePath: string,
  threadId: string,
): Promise<TelepathistChatContext> {
  let context: VoxContext<TelepathistParameters> | undefined;
  try {
    await fs.access(databasePath);
    const identifier = parseDatabaseIdentifier(databasePath);
    const instance = threadId.replaceAll('-', '');
    const contextId = `${identifier.gameID}-telepath_${instance}-${identifier.playerID}`;

    void VoxSpanExporter.getInstance().createContext(contextId, 'telepathist');
    context = new VoxContext<TelepathistParameters>({}, contextId);
    context.loadToolCache();
    context.registerAgentTools();

    const parameters = await createTelepathistParameters(databasePath, identifier);
    context.setBaseParameters(parameters);
    return {
      contextId,
      gameID: identifier.gameID,
      playerID: identifier.playerID,
      identity: {
        name: parameters.civilizationName,
        leader: parameters.leaderName,
      },
    };
  } catch (error) {
    if (context) {
      await context.shutdown().catch(() => undefined);
    }
    throw error;
  }
}

/** Production factory wired to the application registries and chat store. */
export const chatThreadFactory = createChatThreadFactory({
  getContext: (contextId) => contextRegistry.get<StrategistParameters>(contextId),
  getAgent: (agentName) => agentRegistry.get(agentName),
  getAssignments: getActiveAssignments,
  getThread: (threadId) => chatThreadStore.get(threadId),
  setThread: (thread) => chatThreadStore.set(thread),
  isThreadBusy,
  compactThread: autoCompact,
  createOrdinaryThreadId: uuidv4,
  createDiplomacyThreadId: diplomacyThreadId,
  createTelepathistContext: createProductionTelepathistContext,
});

/** Open or reopen a production diplomacy chat thread. */
export const openDiplomacyChat = chatThreadFactory.openDiplomacyChat;

/** Open a production ordinary chat thread. */
export const openOrdinaryChat = chatThreadFactory.openOrdinaryChat;
