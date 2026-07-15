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
import { autoCompact, diplomacyThreadId } from '../../utils/diplomacy/transcript.js';
import {
  parseContextIdentifier,
  parseDatabaseIdentifier,
} from '../../utils/telemetry/identifier-parser.js';
import { VoxSpanExporter } from '../../utils/telemetry/vox-exporter.js';
import { createLogger } from '../../utils/logger.js';
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

    const voice = agentOverride ?? assignments?.[targetPlayerID]?.diplomat ?? 'diplomat';
    if (!dependencies.getAgent(voice)) {
      throw new ChatOpenError(404, `Agent ${voice} not found`);
    }

    const audienceRole = callerRole?.trim() || 'the leader';
    const targetIdentity = sentTargetIdentity ?? civIdentity(targetContext, targetPlayerID);
    const initiatorIdentity = sentCallerIdentity ?? civIdentity(targetContext, initiatorID);
    const targetCiv = displayIdentity(targetIdentity);
    const initiatorCiv = displayIdentity(initiatorIdentity);
    const id = dependencies.createDiplomacyThreadId(gameID, initiatorID, targetPlayerID);
    const ordered = orderParticipants(
      { id: targetPlayerID, role: voice, identity: targetIdentity },
      { id: initiatorID, role: audienceRole, identity: initiatorIdentity },
    );
    const existing = dependencies.getThread(id);

    if (existing) {
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

    let gameID = 'unknown';
    let voicedID = 0;
    const contextType = databasePath ? 'database' : 'live';
    let effectiveContextId = contextId;
    let voicedIdentity: ParticipantIdentity | undefined;

    if (contextId) {
      const existingContext = dependencies.getContext(contextId);
      if (!existingContext) {
        throw new ChatOpenError(400, `Connection not found: ${contextId}`);
      }

      logger.info(`Using existing VoxContext: ${contextId}`);
      const identifier = parseContextIdentifier(contextId);
      gameID = identifier.gameID;
      voicedID = identifier.playerID;
      voicedIdentity = civIdentity(existingContext, voicedID);
    } else if (databasePath) {
      try {
        const telepathist = await dependencies.createTelepathistContext(databasePath);
        effectiveContextId = telepathist.contextId;
        gameID = telepathist.gameID;
        voicedID = telepathist.playerID;
        voicedIdentity = telepathist.identity;
        logger.info(`Created new VoxContext for telepathist mode: ${effectiveContextId}`);
      } catch (error) {
        logger.error('Failed to create telepathist context', { error });
        throw new ChatOpenError(400, `Failed to initialize database: ${databasePath}`);
      }
    }

    const callerID = callerPlayerID !== undefined && callerPlayerID >= 0
      ? callerPlayerID
      : observerID;
    const audienceRole = callerRole?.trim() || 'Observer';
    const callerIdentity = sentCallerIdentity
      ?? (callerID >= 0
        ? civIdentity(dependencies.getContext(effectiveContextId!), callerID)
        : undefined);
    const ordered = orderParticipants(
      { id: voicedID, role: requestedAgentName, identity: voicedIdentity },
      { id: callerID, role: audienceRole, identity: callerIdentity },
    );
    const id = dependencies.createOrdinaryThreadId();
    const thread: EnvoyThread = {
      id,
      agent: voicedID,
      title: `${requestedAgentName} - ${new Date().toLocaleString()}`,
      gameID,
      ...ordered,
      diplomacy: false,
      contextType,
      contextId: effectiveContextId!,
      databasePath,
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
async function createProductionTelepathistContext(databasePath: string): Promise<TelepathistChatContext> {
  let context: VoxContext<TelepathistParameters> | undefined;
  try {
    await fs.access(databasePath);
    const identifier = parseDatabaseIdentifier(databasePath);
    const contextId = `${identifier.gameID}-telepath-${identifier.playerID}`;

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
  compactThread: autoCompact,
  createOrdinaryThreadId: uuidv4,
  createDiplomacyThreadId: diplomacyThreadId,
  createTelepathistContext: createProductionTelepathistContext,
});

/** Open or reopen a production diplomacy chat thread. */
export const openDiplomacyChat = chatThreadFactory.openDiplomacyChat;

/** Open a production ordinary chat thread. */
export const openOrdinaryChat = chatThreadFactory.openOrdinaryChat;
