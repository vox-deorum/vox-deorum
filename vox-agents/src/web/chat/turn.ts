/**
 * @module web/chat/turn
 *
 * Runs one chat turn without depending on Express or SSE wire formatting.
 */

import { agentRegistry } from '../../infra/agent-registry.js';
import { contextRegistry } from '../../infra/context-registry.js';
import type { StrategistParameters } from '../../strategist/strategy-parameters.js';
import { ensureGameState } from '../../strategist/strategy-parameters.js';
import type {
  ChatMessageRequest,
  ChatStreamSink,
  ChatTurnRejection,
  EnvoyThread,
  StreamingEventCallback,
} from '../../types/index.js';
import {
  agentName,
  isClosedThisTurn,
  needsRetryReply,
  retryMessage,
} from '../../utils/diplomacy/transcript.js';
import { hydrateDealRow } from '../../utils/diplomacy/transcript-utils.js';
import {
  beginChatTurn,
  ThreadBusyError,
  type ChatTurn,
  type TurnCommit,
} from '../../utils/diplomacy/chat-turn-commit.js';
import {
  IllegalDealError,
  ProposalConflictError,
  readDealMessages,
} from '../../utils/diplomacy/deal.js';
import { createLogger } from '../../utils/logger.js';
import {
  createSendMessageStreamer,
  type StreamChunk,
} from '../../utils/models/send-message-stream.js';
import { DealPayloadSchema } from '../../../../mcp-server/dist/utils/deal-schema.js';
import type { DealTranscriptMessage } from '../../../../mcp-server/dist/utils/deal-schema.js';
import { currentTurnOf } from './enrichment.js';
import { chatThreadStore } from './store.js';

const logger = createLogger('webui:chat-turn');

/** Test whether an untrusted request body is a record whose fields can be inspected safely. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse the untrusted route body into the canonical discriminated chat request contract. */
function parseRequest(request: unknown): ChatMessageRequest | ChatTurnRejection {
  if (!isRecord(request)) {
    return { status: 400, error: 'Chat request body must be an object.' };
  }

  if (typeof request.chatId !== 'string' || request.chatId.trim().length === 0) {
    return { status: 400, error: 'Chat ID is required' };
  }
  const chatId = request.chatId;

  if (request.kind === 'text') {
    if (typeof request.message !== 'string' || request.message.trim().length === 0) {
      return { status: 400, error: 'Message is required' };
    }
    return { kind: 'text', chatId, message: request.message };
  }

  if (request.kind === 'deal') {
    const parsed = DealPayloadSchema.safeParse(request.deal);
    if (!parsed.success) {
      return { status: 400, error: `Invalid deal payload: ${parsed.error.message}` };
    }
    if (request.expectedProposalID !== undefined
      && (typeof request.expectedProposalID !== 'number'
        || !Number.isSafeInteger(request.expectedProposalID)
        || request.expectedProposalID <= 0)) {
      return { status: 400, error: 'expectedProposalID must be a positive safe integer when provided.' };
    }
    return {
      kind: 'deal',
      chatId,
      deal: parsed.data,
      expectedProposalID: request.expectedProposalID,
    };
  }

  return { status: 400, error: 'kind must be either "text" or "deal".' };
}

/** Build the durable turn commit or return a pre-stream validation error. */
function parseCommit(
  request: ChatMessageRequest,
  thread: EnvoyThread,
): TurnCommit | ChatTurnRejection {
  if (request.kind === 'deal') {
    if (!thread.diplomacy) {
      return { status: 400, error: 'Only diplomacy conversations support deal actions.' };
    }
    return {
      kind: 'deal',
      chatId: request.chatId,
      deal: request.deal,
      expectedProposalID: request.expectedProposalID,
    };
  }
  return request;
}

/** Test whether a parsed commit result is a pre-stream rejection. */
function isRejection(value: TurnCommit | ChatTurnRejection): value is ChatTurnRejection {
  return 'status' in value;
}

/** Map a begin-turn failure to the public pre-stream HTTP contract. */
function mapBeginTurnError(error: unknown): ChatTurnRejection {
  if (error instanceof ThreadBusyError) {
    return {
      status: 409,
      error: 'A reply is already being generated for this conversation. Please wait for it to finish.',
    };
  }
  if (error instanceof ProposalConflictError) {
    return { status: 409, error: error.message };
  }
  if (error instanceof IllegalDealError) {
    return { status: 400, error: error.message };
  }
  logger.error('Failed to commit the turn to the transcript store', { error });
  return { status: 502, error: 'Failed to record your message. Please retry.' };
}

/** Emit one spoken text delta through the transport-neutral sink. */
function emitSpoken(sink: ChatStreamSink, text: string, id: string): void {
  sink.message({ type: 'text-delta', text, id });
}

/**
 * Run a chat request through validation, durable commit, agent execution, and terminal cleanup.
 * A returned rejection is always pre-stream. Undefined means the request committed and emitted.
 */
export async function runChatTurn(
  body: unknown,
  sink: ChatStreamSink,
): Promise<ChatTurnRejection | undefined> {
  const request = parseRequest(body);
  if (isRejection(request)) return request;
  const { chatId } = request;

  const thread = chatThreadStore.get(chatId);
  if (!thread) return { status: 404, error: 'Chat thread not found' };

  const parsedCommit = parseCommit(request, thread);
  if (isRejection(parsedCommit)) return parsedCommit;
  const commit = parsedCommit;

  const voxContext = contextRegistry.get<StrategistParameters>(thread.contextId);
  if (!voxContext) {
    return { status: 400, error: 'Context not found. It may have been shut down.' };
  }

  const liveTurn = currentTurnOf(voxContext);
  if (thread.contextType === 'live' && liveTurn === undefined) {
    return {
      status: 503,
      error: 'The live game turn is not available yet. Please retry once the game is running.',
    };
  }
  const currentTurn = liveTurn ?? 0;
  if (thread.diplomacy && isClosedThisTurn(thread.closeTurn, currentTurn)) {
    return {
      status: 409,
      error: 'This conversation was closed this turn and cannot be reopened until a later turn.',
    };
  }

  let turn: ChatTurn;
  try {
    turn = await beginChatTurn(thread, commit, currentTurn);
  } catch (error) {
    return mapBeginTurnError(error);
  }

  let completed = false;
  try {
    sink.connected({ sessionId: thread.id, deal: turn.dealRow });

    const voiceName = agentName(thread);
    const suppressFreeText = Boolean(voiceName && agentRegistry.get(voiceName)?.suppressFreeText);
    const streamer = createSendMessageStreamer(
      (text, id) => emitSpoken(sink, text, id),
      { suppressFreeText },
    );
    const streamCallback: StreamingEventCallback = {
      OnChunk: ({ chunk }) => {
        if (!streamer.handleChunk(chunk as StreamChunk)) {
          sink.message(chunk as StreamChunk);
        }
      },
    };
    const streamProgress = (message: string): void => {
      emitSpoken(sink, `${message}\n`, 'progress');
    };

    const overrides: Partial<StrategistParameters> | undefined = thread.contextType === 'live'
      ? {
        turn: currentTurn,
        before: currentTurn * 1000000 + 999999,
        after: currentTurn * 1000000,
      }
      : undefined;
    const knownDealIDs = new Set(thread.messages.flatMap((message) => (
      message.deal ? [message.deal.ID] : []
    )));
    const replyStart = thread.messages.length;
    let contextLengthFailed = false;
    await voxContext.withRun({ overrides, streamProgress }, async (run) => {
      sink.onDisconnect(() => {
        if (completed) return;
        logger.info('Chat client disconnected');
        run.abort();
      });

      const params = run.parameters;
      if (thread.contextType === 'live' && params.gameStates && !params.gameStates[params.turn]) {
        await ensureGameState(voxContext, params);
      }

      const voice = agentName(thread);
      if (!voice) {
        sink.error({ message: 'Could not resolve the voicing agent for this conversation' });
        return;
      }

      const agent = agentRegistry.get(voice);
      if (agent?.programmatic) {
        if (commit.kind === 'deal') {
          sink.error({ message: 'Deal actions are not supported by this conversation.' });
          return;
        }
        await agent.handleMessage(params, thread, commit.message, (text: string) => {
          emitSpoken(sink, text, 'programmatic');
        });
      } else {
        await voxContext.execute(
          voice,
          thread,
          streamCallback,
          undefined,
          () => { contextLengthFailed = true; },
          { throwOnError: true },
        );
      }

      if (contextLengthFailed) {
        sink.error({
          message: 'This conversation is too long for the model to continue. Please start a new one.',
        });
        return;
      }

      const replySlice = thread.messages.slice(replyStart);
      if (thread.diplomacy && needsRetryReply(replySlice, { sendMessageOnly: suppressFreeText })) {
        emitSpoken(sink, retryMessage, 'retry');
      }

      await turn.complete({ sendMessageOnly: suppressFreeText });
      let newDeals: DealTranscriptMessage[] = [];
      if (thread.diplomacy) {
        try {
          const rows = await readDealMessages(thread.player1ID, thread.player2ID);
          newDeals = rows.filter((row) => !knownDealIDs.has(row.ID));
          if (newDeals.length > 0) {
            thread.messages.splice(
              replyStart,
              0,
              ...newDeals.map((row) => hydrateDealRow(row, thread.agent)),
            );
          }
        } catch (error) {
          logger.error("Failed to reconcile the diplomat's mid-run deal rows after the turn", { error });
        }
      }
      sink.done({
        sessionId: thread.id,
        messageCount: thread.messages.length,
        deals: newDeals,
      });
    });
  } catch (error) {
    logger.error('Failed to execute agent', { error });
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    sink.error({ message: `Failed to execute agent: ${errorMessage}` });
  } finally {
    turn.finish();
    completed = true;
  }

  return undefined;
}
