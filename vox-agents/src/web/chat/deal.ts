/**
 * @module web/chat/deal
 *
 * The Express face of the blocking diplomacy operations: conversation close, deal inspection, and the
 * accept / reject deal actions.
 *
 * Everything here is HTTP: resolve the `chatId`, parse the request body, call a transport-neutral
 * action, map its typed errors onto the public status classes. The domain logic — the diplomacy-thread
 * guard, the live-turn and closed-this-turn gate, the per-thread lock, the authoritative backend call,
 * and the live-cache hydration — lives in `utils/diplomacy/deal/deal-actions.ts` so the in-game panel can
 * take exactly the same path (stage 7.04 work item 1).
 *
 * The public status classes, unchanged:
 *
 * | Error                                        | HTTP |
 * |----------------------------------------------|-----:|
 * | invalid request, or `IllegalDealError`        |  400 |
 * | thread not found                              |  404 |
 * | busy, closed this turn, or proposal conflict  |  409 |
 * | live turn unavailable                         |  503 |
 * | store, bridge, inspection, enactment failure   |  502 |
 */

import { Router, type Request, type Response } from 'express';
import type {
  DealAcceptRequest,
  DealMessagesResponse,
  DealRejectRequest,
  ErrorResponse,
  GetChatResponse,
  InspectDealRequest,
  InspectDealResponse,
  EnvoyThread,
} from '../../types/index.js';
import {
  IllegalDealError,
  ProposalConflictError,
  closeConversation,
  inspectDeal,
  readDealMessages,
} from '../../utils/diplomacy/deal/deal.js';
import {
  NotDiplomacyThreadError,
  acceptDealAction,
  rejectDealAction,
} from '../../utils/diplomacy/deal/deal-actions.js';
import {
  ThreadBusyError,
  threadBusyMessage,
  withThreadLock,
} from '../../utils/diplomacy/turn/chat-turn-commit.js';
import {
  ConversationClosedThisTurnError,
  LiveTurnUnavailableError,
  requireOpenConversationTurn,
} from '../../utils/diplomacy/turn/live-turn.js';
import { audienceID, insertDurableRows } from '../../utils/diplomacy/transcript/transcript.js';
import { createLogger } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errors.js';
import { DealPayloadSchema } from '../../../../mcp-server/dist/utils/deal-schema.js';
import { sendError } from '../http-utils.js';
import { enrichChat } from './enrichment.js';
import { chatThreadStore } from './store.js';

const logger = createLogger('webui:chat-deal');

/** One mapped HTTP failure: the status class and the body the client receives. */
interface MappedFailure {
  status: number;
  error: string;
}

/** Resolve a diplomacy thread or send the public lookup or mode error. */
function resolveDealThread(chatId: string, res: Response): EnvoyThread | undefined {
  const thread = chatThreadStore.get(chatId);
  if (!thread) {
    sendError(res, 404, 'Chat thread not found');
    return undefined;
  }
  if (!thread.diplomacy) {
    sendError(res, 400, 'Only diplomacy conversations support deal actions');
    return undefined;
  }
  return thread;
}

/**
 * The single mapper from the shared actions' typed errors to the public status classes. Every branch
 * keys off the error TYPE — never its message text — so the same failure reaches the Web and the
 * in-game panel classified identically.
 *
 * @param error    The thrown failure.
 * @param fallback Wording for an unrecognized failure — the store, the bridge, the inspector, or the
 *                 enactment refused.
 * @param fallbackStatus Status class for that unrecognized failure. The deal actions report an
 *                 upstream refusal (502); the close control has always reported its own (500), and
 *                 that public class is preserved.
 */
function mapDealActionError(error: unknown, fallback: string, fallbackStatus = 502): MappedFailure {
  if (error instanceof ThreadBusyError) return { status: 409, error: threadBusyMessage };
  if (error instanceof ConversationClosedThisTurnError) return { status: 409, error: error.message };
  if (error instanceof ProposalConflictError) return { status: 409, error: error.message };
  if (error instanceof LiveTurnUnavailableError) return { status: 503, error: error.message };
  if (error instanceof IllegalDealError) return { status: 400, error: error.message };
  if (error instanceof NotDiplomacyThreadError) return { status: 400, error: error.message };
  logger.error(fallback, { error });
  return {
    status: fallbackStatus,
    error: fallbackStatus === 500 ? fallback : errorMessage(error, fallback),
  };
}

/** Register conversation close and blocking deal-status routes. */
export function createAgentDealStatusRoutes(): Router {
  const router = Router();

  router.post(
    '/agents/chat/:chatId/close',
    async (
      req: Request<{ chatId: string }, object, { message?: string }>,
      res: Response<GetChatResponse | ErrorResponse>,
    ): Promise<void> => {
      const thread = chatThreadStore.get(req.params.chatId);
      if (!thread) {
        sendError(res, 404, 'Chat thread not found');
        return;
      }
      if (!thread.diplomacy) {
        sendError(res, 400, 'Only diplomacy conversations can be closed.');
        return;
      }

      const content = req.body?.message?.trim() || 'The conversation has been closed.';
      try {
        // The same live-turn/closed guard the deal actions use; a conversation already closed on this
        // turn cannot be closed again. `closeConversation` retracts any open offer first, then writes
        // the close, and hands back both durable rows so the cache is repaired from what it committed.
        requireOpenConversationTurn(thread, {
          closedMessage: 'This conversation is already closed this turn.',
        });
        await withThreadLock(thread, async () => {
          const { rows } = await closeConversation(thread, audienceID(thread), content);
          insertDurableRows(thread, rows);
          thread.metadata!.updatedAt = new Date();
        });
        res.json({ ...thread, ...enrichChat(thread) });
      } catch (error) {
        const mapped = mapDealActionError(error, 'Failed to close conversation', 500);
        sendError(res, mapped.status, mapped.error);
      }
    },
  );

  router.post(
    '/agents/chat/:chatId/deal/inspect',
    async (
      req: Request<{ chatId: string }, object, InspectDealRequest>,
      res: Response<InspectDealResponse | ErrorResponse>,
    ): Promise<void> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return;

      let deal: InspectDealRequest['deal'];
      if (req.body?.deal !== undefined) {
        const parsed = DealPayloadSchema.safeParse(req.body.deal);
        if (!parsed.success) {
          sendError(res, 400, `Invalid deal payload: ${parsed.error.message}`);
          return;
        }
        deal = parsed.data;
      }

      try {
        const result = await inspectDeal(thread.player1ID, thread.player2ID, deal);
        res.json(result as InspectDealResponse);
      } catch (error) {
        logger.error('Failed to inspect deal', { error });
        sendError(res, 502, errorMessage(error, 'Failed to inspect deal'));
      }
    },
  );

  router.post(
    '/agents/chat/:chatId/deal/reject',
    async (
      req: Request<{ chatId: string }, object, DealRejectRequest>,
      res: Response<GetChatResponse | ErrorResponse>,
    ): Promise<void> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return;

      const proposalMessageID = req.body?.proposalMessageID;
      if (typeof proposalMessageID !== 'number') {
        sendError(res, 400, 'proposalMessageID (number) is required');
        return;
      }

      try {
        // A repeat of a rejection this endpoint already made returns the existing row and writes
        // nothing (`changed: false`); the Web response is identical either way, since the client
        // renders the conversation, not the transition.
        await rejectDealAction(thread, proposalMessageID, req.body?.content);
        res.json({ ...thread, ...enrichChat(thread) });
      } catch (error) {
        const mapped = mapDealActionError(error, 'Failed to append deal-reject');
        sendError(res, mapped.status, mapped.error);
      }
    },
  );

  router.post(
    '/agents/chat/:chatId/deal/accept',
    async (
      req: Request<{ chatId: string }, object, DealAcceptRequest>,
      res: Response<GetChatResponse | ErrorResponse>,
    ): Promise<void> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return;
      if (typeof req.body?.proposalMessageID !== 'number') {
        sendError(res, 400, 'proposalMessageID (number) is required');
        return;
      }

      try {
        // No catch-time re-probe of the proposal. Both backend transactions now report a lost race as
        // a typed ProposalConflictError, so the mapper separates a conflict (409) from an
        // infrastructure failure (502) without a second, race-prone read that could report a verdict
        // already stale by the time it lands.
        await acceptDealAction(thread, req.body.proposalMessageID);
        res.json({ ...thread, ...enrichChat(thread) });
      } catch (error) {
        const mapped = mapDealActionError(error, 'Failed to enact deal');
        sendError(res, mapped.status, mapped.error);
      }
    },
  );

  router.get(
    '/agents/chat/:chatId/deals',
    async (
      req: Request<{ chatId: string }>,
      res: Response<DealMessagesResponse | ErrorResponse>,
    ): Promise<void> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return;
      try {
        const messages = await readDealMessages(thread.player1ID, thread.player2ID);
        res.json({ messages: messages as DealMessagesResponse['messages'] });
      } catch (error) {
        logger.error('Failed to read deal messages', { error });
        sendError(res, 502, errorMessage(error, 'Failed to read deal messages'));
      }
    },
  );

  return router;
}
