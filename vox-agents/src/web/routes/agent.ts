/**
 * @module web/routes/agent
 *
 * API routes for agent management and chat functionality.
 * Provides endpoints for listing agents, managing chat sessions,
 * and streaming chat interactions.
 *
 * Threads carry an endpoint pair (A = caller/audience, B = LLM-voiced seat) mirroring the
 * mcp-server transcript shape. For civ↔civ diplomacy the in-memory `chatSessions` map is a
 * write-through cache over the durable transcript store: threads are hydrated from
 * `read-transcript` on open and every message is written through `append-message`. Ordinary
 * observer/telepathist chats keep their in-memory behavior under the same endpoint-pair shape.
 */

import { Router, Request, Response } from 'express';
import { agentRegistry } from '../../infra/agent-registry.js';
import { contextRegistry } from '../../infra/context-registry.js';
import { sessionRegistry } from '../../infra/session-registry.js';
import { StrategistSession } from '../../strategist/strategist-session.js';
import { pacingInterruptionRegistry } from '../../strategist/pacing/registry.js';
import { VoxContext } from '../../infra/vox-context.js';
import { createLogger } from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { ModelMessage } from 'ai';
import fs from 'fs/promises';
import {
  parseContextIdentifier,
  parseDatabaseIdentifier,
} from '../../utils/telemetry/identifier-parser.js';
import { StrategistParameters, getRecentGameState, ensureGameState } from '../../strategist/strategy-parameters.js';
import { createTelepathistParameters, TelepathistParameters } from '../../telepathist/telepathist-parameters.js';
import {
  ListAgentsResponse,
  ListPacingInterruptionsResponse,
  CreateChatRequest,
  CreateChatResponse,
  ListChatsResponse,
  GetChatResponse,
  ChatResponseEnrichment,
  ChatMessageRequest,
  DeleteChatResponse,
  ErrorResponse,
  AgentInfo,
  PlayerAssignment,
  StreamingEventCallback,
  EnvoyThread
} from '../../types/index.js';
import { VoxSpanExporter } from '../../utils/telemetry/vox-exporter.js';
import {
  diplomacyThreadId,
  orderPair,
  agentName,
  audienceID,
  readTranscript,
  hydrateMessages,
  deriveCloseTurn,
  isClosedThisTurn,
  joinAssistantText,
  appendTranscriptMessage,
  appendCloseMessage,
} from '../../utils/diplomacy/transcript.js';
import {
  inspectDeal,
  appendDealProposal,
  appendDealReject,
  readDealMessages,
  validateDealForThread,
} from '../../utils/diplomacy/deal.js';
// Pinned deal contract — validate request bodies against the same schema mcp-server uses.
import { DealPayloadSchema } from '../../../../mcp-server/dist/utils/deal-schema.js';
import type {
  InspectDealRequest,
  InspectDealResponse,
  DealProposalRequest,
  DealRejectRequest,
  DealAcceptRequest,
  DealActionResponse,
  DealMessagesResponse,
} from '../../types/index.js';

const logger = createLogger('webui:agent-routes');

// In-memory storage for chat sessions. For diplomacy threads this is a write-through cache
// over the durable mcp-server transcript store; ordinary chats live only here.
const chatSessions = new Map<string, EnvoyThread>();

/** The observer / no-seat endpoint sentinel (shared with the mcp-server store). */
const OBSERVER_ID = -1;

/** Triple-brace special tokens (e.g. {{{Greeting}}}) are agent triggers, not archival text. */
const SPECIAL_MESSAGE = /^\{\{\{.+\}\}\}$/;

/** Resolve the active strategist session's per-seat agent assignments, if any. */
function getActiveAssignments(): Record<number, PlayerAssignment> | undefined {
  const session = sessionRegistry.getActive();
  return session instanceof StrategistSession ? session.getPlayerAssignments() : undefined;
}

/** The seat whose strategist is the human-control strategist, if one exists. */
function resolveHumanSeat(assignments?: Record<number, PlayerAssignment>): number | undefined {
  if (!assignments) return undefined;
  for (const [idStr, a] of Object.entries(assignments)) {
    if (a.strategist === 'human-strategist') return parseInt(idStr);
  }
  return undefined;
}

/**
 * Display name for a player from a live context's most recent game state
 * (e.g. "Bismarck of Germany", or just "Germany"). Undefined when unavailable.
 */
function civDisplayName(context: VoxContext<StrategistParameters> | undefined, playerID: number): string | undefined {
  const params = context?.lastParameter;
  // Guard against non-strategist (e.g. telepathist) params, which have no gameStates.
  if (!params || playerID < 0 || !params.gameStates) return undefined;
  const recent = getRecentGameState(params);
  const data = recent?.players?.[playerID.toString()];
  if (typeof data === 'object' && data !== null) {
    const civ = (data as Record<string, unknown>).Civilization;
    const leader = (data as Record<string, unknown>).Leader;
    if (typeof civ === 'string') {
      return typeof leader === 'string' ? `${leader} of ${civ}` : civ;
    }
  }
  return undefined;
}

/**
 * Display enrichment for a chat response: the current turn (for stale/close-lock detection)
 * plus human-readable civ labels for the voiced seat (`thread.agent`) and the audience,
 * resolved from the live context's parameters.
 */
function enrichChat(thread: EnvoyThread): ChatResponseEnrichment {
  const voxContext = contextRegistry.get<StrategistParameters>(thread.contextId);
  const params = voxContext?.lastParameter as Record<string, unknown> | undefined;

  // Telepathist (database) contexts carry identity on TelepathistParameters, not game state.
  let voicedCiv = civDisplayName(voxContext, thread.agent);
  if (!voicedCiv && typeof params?.civilizationName === 'string') {
    const leader = params.leaderName;
    voicedCiv = typeof leader === 'string' ? `${leader} of ${params.civilizationName}` : params.civilizationName;
  }

  return {
    currentTurn: currentTurnOf(voxContext),
    voicedID: thread.agent,
    voicedCiv,
    audienceCiv: civDisplayName(voxContext, audienceID(thread)),
  };
}

/**
 * The authoritative "current turn" for stale-turn / close-lock detection. A live context owns
 * a reference to its session, which tracks the live game turn from the game's own
 * PlayerDoneTurn / GameSwitched notifications — so it stays correct even when a conversation
 * outlives the pause that started it (specs §8), unlike a context's decision-point
 * `parameters.turn` snapshot. Falls back to the params turn for standalone contexts
 * (database/telepathist) that have no owning session.
 */
function currentTurnOf(context: VoxContext<StrategistParameters> | undefined): number | undefined {
  return context?.session?.getTurn() ?? context?.lastParameter?.turn;
}

/**
 * Create agent API routes
 * @returns Express router with agent endpoints
 */
export function createAgentRoutes(): Router {
  const router = Router();

  /**
   * GET /api/agents - List all available agents
   * Response includes agent names, descriptions, and tags for filtering
   */
  router.get('/agents', (_req: Request, res: Response<ListAgentsResponse | ErrorResponse>) => {
    try {
      const agents = agentRegistry.getAll();
      const agentList: AgentInfo[] = agents.map(agent => ({
        name: agent.name,
        description: agent.description,
        tags: agent.tags || []
      }));

      res.json({ agents: agentList });
    } catch (error) {
      logger.error('Failed to list agents', { error });
      res.status(500).json({ error: 'Failed to list agents' });
    }
  });

  /**
   * GET /api/agents/pacing-interruptions - List registered strategist pacing interruptions
   */
  router.get('/agents/pacing-interruptions', (_req: Request, res: Response<ListPacingInterruptionsResponse | ErrorResponse>) => {
    try {
      const interruptions = pacingInterruptionRegistry.getAll().map(strategy => ({
        name: strategy.name,
        label: strategy.label,
        description: strategy.description
      }));

      res.json({ interruptions });
    } catch (error) {
      logger.error('Failed to list pacing interruptions', { error });
      res.status(500).json({ error: 'Failed to list pacing interruptions' });
    }
  });

  /**
   * POST /api/agents/chat - Open or find a chat thread.
   *
   * Diplomacy mode (`mode: 'diplomacy'`): finds or opens the single conversation for a
   * civ pair, resolving the target seat's diplomat as the default voice and hydrating the
   * transcript from the durable store. Ordinary mode: a one-off observer/telepathist chat
   * voiced by the chosen agent.
   */
  router.post('/agents/chat', async (req: Request<{}, {}, CreateChatRequest>, res: Response<CreateChatResponse | ErrorResponse>): Promise<Response> => {
    try {
      if (req.body.mode === 'diplomacy') {
        return await openDiplomacyChat(req, res);
      }
      return await openOrdinaryChat(req, res);
    } catch (error) {
      logger.error('Failed to create session', { error });
      return res.status(500).json({ error: 'Failed to create session' });
    }
  });

  /**
   * GET /api/agents/chats - Get all active chat threads
   */
  router.get('/agents/chats', (_req: Request, res: Response<ListChatsResponse | ErrorResponse>) => {
    try {
      const chats = Array.from(chatSessions.values());
      res.json({ chats });
    } catch (error) {
      logger.error('Failed to list chat threads', { error });
      res.status(500).json({ error: 'Failed to list chat threads' });
    }
  });

  /**
   * GET /api/agents/chat/:chatId - Get chat thread details with messages
   */
  router.get('/agents/chat/:chatId', (req: Request, res: Response<GetChatResponse | ErrorResponse>): Response => {
    try {
      const { chatId } = req.params;
      const thread = chatSessions.get(chatId);

      if (!thread) {
        return res.status(404).json({ error: 'Chat thread not found' });
      }

      // Enrich with current turn + display labels resolved from the live context.
      return res.json({ ...thread, ...enrichChat(thread) });
    } catch (error) {
      logger.error('Failed to get chat thread', { error });
      return res.status(500).json({ error: 'Failed to get chat thread' });
    }
  });

  /**
   * POST /api/agents/message - Unified streaming chat endpoint.
   *
   * For diplomacy threads this appends the caller's text through the durable store, executes
   * the resolved diplomat in the target seat's context, streams the reply, then appends the
   * reply through the store. Ordinary chats stream without persisting.
   */
  router.post('/agents/message', async (req: Request<{}, {}, ChatMessageRequest>, res: Response): Promise<void> => {
    const { chatId, message } = req.body;

    if (!chatId) {
      res.status(400).json({ error: 'Chat ID is required' });
      return;
    }

    const thread = chatSessions.get(chatId);
    if (!thread) {
      res.status(404).json({ error: 'Chat thread not found' });
      return;
    }

    // Message is always required (use special messages like {{{Greeting}}} for agent-initiated responses)
    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const voxContext = contextRegistry.get<StrategistParameters>(thread.contextId);
    if (!voxContext) {
      res.status(400).json({ error: 'Context not found. It may have been shut down.' });
      return;
    }

    const currentTurn = currentTurnOf(voxContext) ?? 0;

    // A diplomacy conversation closed on the current turn is locked until a later turn (specs §8).
    if (thread.diplomacy && isClosedThisTurn(thread.closeTurn, currentTurn)) {
      res.status(409).json({ error: 'This conversation was closed this turn and cannot be reopened until a later turn.' });
      return;
    }

    // For diplomacy, archive the caller's message before doing anything else (archival write,
    // no streaming/agents). The caller is the audience (the non-voiced seat). Special tokens
    // (e.g. {{{Greeting}}}) are agent triggers, not real utterances, so they are never persisted.
    const isSpecial = SPECIAL_MESSAGE.test(message);
    if (thread.diplomacy && !isSpecial) {
      try {
        await appendTranscriptMessage(thread, audienceID(thread), 'text', message);
      } catch (error) {
        logger.error('Failed to append diplomacy message', { error });
        res.status(502).json({ error: 'Failed to persist message to the transcript store' });
        return;
      }
    }

    // Add user message to thread (includes special messages like {{{Greeting}}} for agent detection)
    const userMessage: ModelMessage = { role: 'user', content: message };
    thread.messages.push({
      message: userMessage,
      metadata: { datetime: new Date(), turn: currentTurn }
    });
    thread.metadata!.updatedAt = new Date();

    // Set up SSE stream
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const sendEvent = (event: string, data: Record<string, unknown>) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('connected', { sessionId: thread.id });

    // Remember where this turn's new messages begin so we can capture the LLM reply.
    const messagesBefore = thread.messages.length;

    try {
      const streamCallback: StreamingEventCallback = {
        OnChunk: ({ chunk }) => {
          sendEvent('message', chunk as Record<string, unknown>);
        }
      };

      voxContext.streamProgress = (msg: string) => {
        sendEvent('message', { type: 'text-delta', text: msg + '\n', id: 'progress' });
      };

      const params = voxContext.lastParameter!;

      // Only ensure game state for live contexts (not database-backed telepathist sessions)
      if (thread.contextType === 'live') {
        const stratParams = params as StrategistParameters;
        if (stratParams.gameStates && !stratParams.gameStates[stratParams.turn]) {
          await ensureGameState(voxContext as VoxContext<StrategistParameters>, stratParams);
        }
      }

      // Resolve the executing VoxAgent: the agent-voiced seat's role descriptor.
      const voice = agentName(thread);
      if (!voice) {
        sendEvent('error', { message: 'Could not resolve the voicing agent for this conversation' });
        return;
      }

      // Check if the agent handles messages programmatically (no LLM)
      const agent = agentRegistry.get(voice);
      if (agent?.programmatic) {
        await agent.handleMessage(params, thread, message, (text: string) => {
          sendEvent('message', { type: 'text-delta', text, id: 'programmatic' });
        });
      } else {
        await voxContext.execute(voice, params, thread, streamCallback);
      }

      // For diplomacy, persist the diplomat's reply (the agent-voiced seat) through the store.
      if (thread.diplomacy) {
        const reply = joinAssistantText(thread.messages.slice(messagesBefore));
        if (reply) {
          try {
            await appendTranscriptMessage(thread, thread.agent, 'text', reply);
          } catch (error) {
            logger.error('Failed to append diplomat reply to transcript store', { error });
          }
        }
      }

      sendEvent('done', {
        sessionId: thread.id,
        messageCount: thread.messages.length
      });
    } catch (error) {
      logger.error('Failed to execute agent', { error });
      const errorMessage = error instanceof Error ? error.message : 'unknown';
      sendEvent('error', { message: `Failed to execute agent: ${errorMessage}` })
    } finally {
      res.end();
    }

    req.on('close', () => {
      logger.info(`Chat client disconnected`);
      voxContext.abort(false);
    });
  });

  /**
   * POST /api/agents/chat/:chatId/close - Close a diplomacy conversation from the Web.
   *
   * Writes the `close` special message (authored by the caller / audience seat) through the
   * same archival path the diplomat's close-conversation tool uses, locking the conversation
   * for the rest of the current turn.
   */
  router.post('/agents/chat/:chatId/close', async (req: Request<{ chatId: string }, {}, { message?: string }>, res: Response<GetChatResponse | ErrorResponse>): Promise<Response> => {
    try {
      const { chatId } = req.params;
      const thread = chatSessions.get(chatId);
      if (!thread) {
        return res.status(404).json({ error: 'Chat thread not found' });
      }
      if (!thread.diplomacy) {
        return res.status(400).json({ error: 'Only diplomacy conversations can be closed.' });
      }

      const voxContext = contextRegistry.get<StrategistParameters>(thread.contextId);
      const currentTurn = currentTurnOf(voxContext) ?? thread.metadata?.turn ?? 0;

      if (isClosedThisTurn(thread.closeTurn, currentTurn)) {
        return res.status(409).json({ error: 'This conversation is already closed this turn.' });
      }

      // appendCloseMessage records the server-stamped turn on the thread; currentTurn is only
      // a fallback if the store omits it. Use the authoritative result for the local echo too.
      const content = req.body?.message?.trim() || 'The conversation has been closed.';
      const closedAt = await appendCloseMessage(thread, audienceID(thread), content, currentTurn);
      thread.messages.push({
        message: { role: 'user', content },
        metadata: { datetime: new Date(), turn: closedAt }
      });
      thread.metadata!.updatedAt = new Date();

      return res.json({ ...thread, ...enrichChat(thread) });
    } catch (error) {
      logger.error('Failed to close conversation', { error });
      return res.status(500).json({ error: 'Failed to close conversation' });
    }
  });

  // ============================================================================
  // Typed deal-action routes (interactive-diplomacy stage 4)
  //
  // Structured deal endpoints — distinct from the plain-text /api/agents/message path.
  // The Web reaches mcp-server only through these routes (specs §6, no direct Web→mcp
  // channel). In preview mode the human builds and round-trips proposal/counter (and may
  // reject/retract); acceptance is wired but deferred to the enactment route (stage 6).
  // ============================================================================

  /** Resolve a diplomacy thread for a deal action, or send the appropriate error and return undefined. */
  const resolveDealThread = (chatId: string, res: Response): EnvoyThread | undefined => {
    const thread = chatSessions.get(chatId);
    if (!thread) {
      res.status(404).json({ error: 'Chat thread not found' });
      return undefined;
    }
    if (!thread.diplomacy) {
      res.status(400).json({ error: 'Only diplomacy conversations support deal actions' });
      return undefined;
    }
    return thread;
  };

  /** True (and sends a 409) when the conversation is closed-locked for the current turn. */
  const isDealLocked = (thread: EnvoyThread, res: Response): boolean => {
    const voxContext = contextRegistry.get<StrategistParameters>(thread.contextId);
    const currentTurn = currentTurnOf(voxContext) ?? thread.metadata?.turn ?? 0;
    if (isClosedThisTurn(thread.closeTurn, currentTurn)) {
      res.status(409).json({ error: 'This conversation was closed this turn and cannot accept deal actions until a later turn.' });
      return true;
    }
    return false;
  };

  /**
   * POST /api/agents/chat/:chatId/deal/inspect - Read-only inspection of a (possibly empty)
   * deal against live game state. Drives the trade screen's tradable range, per-term legality,
   * value estimates, and live re-evaluation as the human edits the deal. Advisory only (§4).
   */
  router.post('/agents/chat/:chatId/deal/inspect', async (req: Request<{ chatId: string }, {}, InspectDealRequest>, res: Response<InspectDealResponse | ErrorResponse>): Promise<Response> => {
    const thread = resolveDealThread(req.params.chatId, res);
    if (!thread) return res;

    let deal: InspectDealRequest['deal'];
    if (req.body?.deal !== undefined) {
      const parsed = DealPayloadSchema.safeParse(req.body.deal);
      if (!parsed.success) {
        return res.status(400).json({ error: `Invalid deal payload: ${parsed.error.message}` });
      }
      deal = parsed.data;
    }

    try {
      const result = await inspectDeal(thread.player1ID, thread.player2ID, deal);
      return res.json(result);
    } catch (error) {
      logger.error('Failed to inspect deal', { error });
      return res.status(502).json({ error: error instanceof Error ? error.message : 'Failed to inspect deal' });
    }
  });

  /**
   * POST /api/agents/chat/:chatId/deal/propose - Present a deal (deal-proposal).
   * POST /api/agents/chat/:chatId/deal/counter - Counter a deal (deal-counter).
   * Both archive the proposed terms (Payload.Deal) plus proposal-time per-item value
   * snapshots through the durable store. In preview mode the author is the human (audience).
   */
  const handleProposal = (messageType: 'deal-proposal' | 'deal-counter') =>
    async (req: Request<{ chatId: string }, {}, DealProposalRequest>, res: Response<DealActionResponse | ErrorResponse>): Promise<Response> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return res;
      if (isDealLocked(thread, res)) return res;

      const parsed = DealPayloadSchema.safeParse(req.body?.deal);
      if (!parsed.success) {
        return res.status(400).json({ error: `Invalid deal payload: ${parsed.error.message}` });
      }
      try {
        validateDealForThread(thread, parsed.data);
      } catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid deal participants' });
      }

      const verb = messageType === 'deal-counter' ? 'countered' : 'proposed';
      const content = req.body?.content?.trim() || `A deal was ${verb}.`;
      try {
        const { id, turn } = await appendDealProposal(thread, audienceID(thread), messageType, content, parsed.data);
        return res.json({ id, messageType, turn });
      } catch (error) {
        logger.error(`Failed to append ${messageType}`, { error });
        return res.status(502).json({ error: error instanceof Error ? error.message : `Failed to append ${messageType}` });
      }
    };
  router.post('/agents/chat/:chatId/deal/propose', handleProposal('deal-proposal'));
  router.post('/agents/chat/:chatId/deal/counter', handleProposal('deal-counter'));

  /**
   * POST /api/agents/chat/:chatId/deal/reject - Decline or retract a proposal (deal-reject).
   * Either endpoint may speak it; in preview the human declines a proposal or retracts its own.
   */
  router.post('/agents/chat/:chatId/deal/reject', async (req: Request<{ chatId: string }, {}, DealRejectRequest>, res: Response<DealActionResponse | ErrorResponse>): Promise<Response> => {
    const thread = resolveDealThread(req.params.chatId, res);
    if (!thread) return res;
    if (isDealLocked(thread, res)) return res;

    const proposalMessageID = req.body?.proposalMessageID;
    if (typeof proposalMessageID !== 'number') {
      return res.status(400).json({ error: 'proposalMessageID (number) is required' });
    }
    const content = req.body?.content?.trim() || 'The deal was rejected.';
    try {
      const { id, turn } = await appendDealReject(thread, audienceID(thread), content, proposalMessageID);
      return res.json({ id, messageType: 'deal-reject', turn });
    } catch (error) {
      logger.error('Failed to append deal-reject', { error });
      return res.status(502).json({ error: error instanceof Error ? error.message : 'Failed to append deal-reject' });
    }
  });

  /**
   * POST /api/agents/chat/:chatId/deal/accept - Accept a proposal.
   *
   * Wired here, but deferred: acceptance is recorded only by the enactment route
   * (enact-agent-deal, stage 6), the sole writer of deal-accept / deal-enacted (pinned
   * contract). In stage-4 preview this acknowledges the intent without a durable write.
   */
  router.post('/agents/chat/:chatId/deal/accept', async (req: Request<{ chatId: string }, {}, DealAcceptRequest>, res: Response<ErrorResponse>): Promise<Response> => {
    const thread = resolveDealThread(req.params.chatId, res);
    if (!thread) return res;
    if (typeof req.body?.proposalMessageID !== 'number') {
      return res.status(400).json({ error: 'proposalMessageID (number) is required' });
    }
    return res.status(501).json({
      error: 'Deal enactment is available from stage 6 (enact-agent-deal). Acceptance is wired but deferred in preview mode.',
    });
  });

  /**
   * GET /api/agents/chat/:chatId/deals - List the conversation's deal messages in append
   * order. The Web reduces these client-side into the latest active proposal (work item 4).
   */
  router.get('/agents/chat/:chatId/deals', async (req: Request<{ chatId: string }>, res: Response<DealMessagesResponse | ErrorResponse>): Promise<Response> => {
    const thread = resolveDealThread(req.params.chatId, res);
    if (!thread) return res;
    try {
      const messages = await readDealMessages(thread.player1ID, thread.player2ID);
      return res.json({ messages: messages as DealMessagesResponse['messages'] });
    } catch (error) {
      logger.error('Failed to read deal messages', { error });
      return res.status(502).json({ error: error instanceof Error ? error.message : 'Failed to read deal messages' });
    }
  });

  /**
   * DELETE /api/agents/chat/:chatId - Delete a chat thread
   */
  router.delete('/agents/chat/:chatId', async (req: Request, res: Response<DeleteChatResponse | ErrorResponse>): Promise<Response> => {
    try {
      const { chatId } = req.params;
      const thread = chatSessions.get(chatId);

      if (!thread) {
        return res.status(404).json({ error: 'Chat thread not found' });
      }

      // If this is a database-backed context (telepathist), shut it down to close DB connections
      if (thread.contextType === 'database' && thread.contextId) {
        const context = contextRegistry.get(thread.contextId);
        if (context) {
          await context.shutdown();
          logger.info(`Shut down telepathist context: ${thread.contextId}`);
        }
      }

      chatSessions.delete(chatId);
      return res.json({ success: true });
    } catch (error) {
      logger.error('Failed to delete chat thread', { error });
      return res.status(500).json({ error: 'Failed to delete chat thread' });
    }
  });

  return router;
}

/**
 * Open or find a civ↔civ diplomacy conversation. One conversation per ordered player pair:
 * the deterministic id ensures reopening hydrates the same thread. The voice defaults to the
 * target seat's configured diplomat, overridable by the local operator.
 */
async function openDiplomacyChat(
  req: Request<{}, {}, CreateChatRequest>,
  res: Response<CreateChatResponse | ErrorResponse>
): Promise<Response> {
  const { contextId, targetPlayerID, initiatorPlayerID, callerRole, agentName: agentOverride, turn } = req.body;

  if (!contextId) {
    return res.status(400).json({ error: 'contextId is required to resolve the game for a diplomacy conversation' });
  }
  if (targetPlayerID === undefined) {
    return res.status(400).json({ error: 'targetPlayerID (the LLM-voiced seat) is required' });
  }

  const { gameID } = parseContextIdentifier(contextId);
  const assignments = getActiveAssignments();

  // Initiator defaults to the human-control seat when the operator doesn't specify one.
  const initiatorID = initiatorPlayerID ?? resolveHumanSeat(assignments);
  if (initiatorID === undefined) {
    return res.status(400).json({ error: 'initiatorPlayerID is required (no human-control seat to default to)' });
  }
  if (initiatorID === targetPlayerID) {
    return res.status(400).json({ error: 'A civilization cannot hold a conversation with itself' });
  }

  // The diplomat is voiced from the target seat's context so its YouAre matches the civ it speaks as.
  const targetContextId = `${gameID}-player-${targetPlayerID}`;
  const targetContext = contextRegistry.get<StrategistParameters>(targetContextId);
  if (!targetContext) {
    return res.status(400).json({ error: `Target seat context not active: ${targetContextId}` });
  }

  // Resolve the voice: explicit operator override, else the target seat's configured diplomat.
  // The target is the agent-voiced seat, so its role descriptor is this agent name (the
  // stage-1 pinned contract); the initiator is the audience.
  const voice = agentOverride ?? assignments?.[targetPlayerID]?.diplomat ?? 'diplomat';
  if (!agentRegistry.get(voice)) {
    return res.status(404).json({ error: `Agent ${voice} not found` });
  }
  const audienceRole = callerRole?.trim() || 'the leader';

  const targetCiv = civDisplayName(targetContext, targetPlayerID);
  const initiatorCiv = civDisplayName(targetContext, initiatorID);

  // Hydrate from the durable store (source of truth for the transcript).
  const transcript = await readTranscript(initiatorID, targetPlayerID);
  const messages = hydrateMessages(transcript, targetPlayerID);
  const closeTurn = deriveCloseTurn(transcript);

  const id = diplomacyThreadId(gameID, initiatorID, targetPlayerID);
  const { player1ID, player2ID } = orderPair(initiatorID, targetPlayerID);
  const existing = chatSessions.get(id);

  if (existing) {
    // Re-sync the write-through cache to the (possibly re-chosen) direction and voice, then
    // refresh from the store. The deterministic id is direction-agnostic, so the operator can
    // reopen the same pair voicing the other seat; re-resolve every direction-derived field
    // (agent, context, roles, title) so they never drift from the current target.
    existing.agent = targetPlayerID;
    existing.contextId = targetContextId;
    existing.title = `${targetCiv ?? `Player ${targetPlayerID}`} ↔ ${initiatorCiv ?? `Player ${initiatorID}`}`;
    existing.player1Role = player1ID === targetPlayerID ? voice : audienceRole;
    existing.player2Role = player2ID === targetPlayerID ? voice : audienceRole;
    existing.messages = messages;
    existing.closeTurn = closeTurn;
    existing.metadata!.updatedAt = new Date();
    return res.json({ ...existing, ...enrichChat(existing) });
  }

  const thread: EnvoyThread = {
    id,
    agent: targetPlayerID,
    title: `${targetCiv ?? `Player ${targetPlayerID}`} ↔ ${initiatorCiv ?? `Player ${initiatorID}`}`,
    gameID,
    player1ID,
    player2ID,
    player1Role: player1ID === targetPlayerID ? voice : audienceRole,
    player2Role: player2ID === targetPlayerID ? voice : audienceRole,
    diplomacy: true,
    contextType: 'live',
    contextId: targetContextId,
    messages,
    closeTurn,
    metadata: {
      createdAt: new Date(),
      updatedAt: new Date(),
      turn,
    }
  };

  chatSessions.set(id, thread);
  return res.json({ ...thread, ...enrichChat(thread) });
}

/**
 * Open an ordinary observer/telepathist chat: the chosen agent voices the context's player
 * to the caller / observer. Kept in-memory only (no write-through).
 */
async function openOrdinaryChat(
  req: Request<{}, {}, CreateChatRequest>,
  res: Response<CreateChatResponse | ErrorResponse>
): Promise<Response> {
  const { agentName: agentNameReq, contextId, databasePath, turn, callerRole, callerPlayerID } = req.body;

  if (!agentNameReq) {
    return res.status(400).json({ error: 'Agent name is required' });
  }

  const agent = agentRegistry.get(agentNameReq);
  if (!agent) {
    return res.status(404).json({ error: `Agent ${agentNameReq} not found` });
  }

  // The voiced player (the agent seat) is parsed from the chosen context / database.
  let gameID = 'unknown';
  let voicedID = 0;
  const contextType = databasePath ? 'database' : 'live';
  let effectiveContextId: string | undefined = contextId;

  if (contextId) {
    const existingContext = contextRegistry.get<StrategistParameters>(contextId);
    if (existingContext) {
      logger.info(`Using existing VoxContext: ${contextId}`);
      const identifierInfo = parseContextIdentifier(contextId);
      gameID = identifierInfo.gameID;
      voicedID = identifierInfo.playerID;
    } else {
      return res.status(400).json({ error: `Connection not found: ${contextId}` });
    }
  } else if (databasePath) {
    let context: VoxContext<TelepathistParameters> | undefined;
    try {
      await fs.access(databasePath);
      const identifierInfo = parseDatabaseIdentifier(databasePath);
      gameID = identifierInfo.gameID;
      voicedID = identifierInfo.playerID;

      effectiveContextId = `${gameID}-telepath-${voicedID}`;
      VoxSpanExporter.getInstance().createContext(effectiveContextId, "telepathist");
      context = new VoxContext<TelepathistParameters>({}, effectiveContextId);

      context.loadToolCache();
      context.registerAgentTools();

      const telepathistParams = await createTelepathistParameters(databasePath, identifierInfo);
      context.lastParameter = telepathistParams;

      logger.info(`Created new VoxContext for telepathist mode: ${effectiveContextId}`);
    } catch (err) {
      logger.error('Failed to create telepathist context', err);
      if (context) {
        await context.shutdown().catch(() => {});
      }
      return res.status(400).json({ error: `Failed to initialize database: ${databasePath}` });
    }
  }

  // The caller / audience: a real seat or the observer sentinel. The agent seat's role IS
  // the agent name (pinned contract); the audience role is the caller's free-form role.
  const callerID = callerPlayerID !== undefined && callerPlayerID >= 0 ? callerPlayerID : OBSERVER_ID;
  const audienceRole = callerRole?.trim() || 'Observer';
  const { player1ID, player2ID } = orderPair(voicedID, callerID);

  const sessionId = uuidv4();
  const thread: EnvoyThread = {
    id: sessionId,
    agent: voicedID,
    title: `${agentNameReq} - ${new Date().toLocaleString()}`,
    gameID,
    player1ID,
    player2ID,
    player1Role: player1ID === voicedID ? agentNameReq : audienceRole,
    player2Role: player2ID === voicedID ? agentNameReq : audienceRole,
    diplomacy: false,
    contextType,
    contextId: effectiveContextId!,
    databasePath,
    messages: [],
    metadata: {
      createdAt: new Date(),
      updatedAt: new Date(),
      turn,
    }
  };

  chatSessions.set(sessionId, thread);
  return res.json({ ...thread, ...enrichChat(thread) });
}
