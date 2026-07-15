/**
 * @module web/chat/deal
 *
 * Registers blocking diplomacy close and deal-status operations.
 */

import { Router, type Request, type Response } from 'express';
import type { StrategistParameters } from '../../strategist/strategy-parameters.js';
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
import { contextRegistry } from '../../infra/context-registry.js';
import {
  appendDealReject,
  closeConversation,
  enactAgentDeal,
  inspectDeal,
  readDealMessages,
  requireCurrentOpenProposal,
} from '../../utils/diplomacy/deal.js';
import { ThreadBusyError, withThreadLock } from '../../utils/diplomacy/chat-turn-commit.js';
import { audienceID, isClosedThisTurn } from '../../utils/diplomacy/transcript.js';
import { createLogger } from '../../utils/logger.js';
import { DealPayloadSchema } from '../../../../mcp-server/dist/utils/deal-schema.js';
import {
  currentTurnOf,
  enrichChat,
  mirrorDealRowsBestEffort,
} from './enrichment.js';
import { chatThreadStore } from './store.js';

const logger = createLogger('webui:chat-deal');

/** Resolve a diplomacy thread or send the public lookup or mode error. */
function resolveDealThread(chatId: string, res: Response): EnvoyThread | undefined {
  const thread = chatThreadStore.get(chatId);
  if (!thread) {
    res.status(404).json({ error: 'Chat thread not found' });
    return undefined;
  }
  if (!thread.diplomacy) {
    res.status(400).json({ error: 'Only diplomacy conversations support deal actions' });
    return undefined;
  }
  return thread;
}

/** Return true and send a conflict when the current turn keeps the conversation closed. */
function isDealLocked(thread: EnvoyThread, res: Response): boolean {
  const context = contextRegistry.get<StrategistParameters>(thread.contextId);
  const currentTurn = currentTurnOf(context) ?? thread.metadata?.turn ?? 0;
  if (!isClosedThisTurn(thread.closeTurn, currentTurn)) return false;

  res.status(409).json({
    error: 'This conversation was closed this turn and cannot accept deal actions until a later turn.',
  });
  return true;
}

/** Register conversation close and blocking deal-status routes. */
export function createAgentDealStatusRoutes(): Router {
  const router = Router();

  router.post(
    '/agents/chat/:chatId/close',
    async (
      req: Request<{ chatId: string }, {}, { message?: string }>,
      res: Response<GetChatResponse | ErrorResponse>,
    ): Promise<Response> => {
      try {
        const thread = chatThreadStore.get(req.params.chatId);
        if (!thread) return res.status(404).json({ error: 'Chat thread not found' });
        if (!thread.diplomacy) {
          return res.status(400).json({ error: 'Only diplomacy conversations can be closed.' });
        }

        const context = contextRegistry.get<StrategistParameters>(thread.contextId);
        const currentTurn = currentTurnOf(context) ?? thread.metadata?.turn ?? 0;
        if (isClosedThisTurn(thread.closeTurn, currentTurn)) {
          return res.status(409).json({ error: 'This conversation is already closed this turn.' });
        }

        const content = req.body?.message?.trim() || 'The conversation has been closed.';
        await withThreadLock(thread, async () => {
          const closedAt = await closeConversation(thread, audienceID(thread), content, currentTurn);
          await mirrorDealRowsBestEffort(thread);
          thread.messages.push({
            message: { role: 'user', content },
            metadata: { datetime: new Date(), turn: closedAt },
          });
          thread.metadata!.updatedAt = new Date();
        });

        return res.json({ ...thread, ...enrichChat(thread) });
      } catch (error) {
        if (error instanceof ThreadBusyError) {
          return res.status(409).json({
            error: 'A reply is already being generated for this conversation. Please wait for it to finish.',
          });
        }
        logger.error('Failed to close conversation', { error });
        return res.status(500).json({ error: 'Failed to close conversation' });
      }
    },
  );

  router.post(
    '/agents/chat/:chatId/deal/inspect',
    async (
      req: Request<{ chatId: string }, {}, InspectDealRequest>,
      res: Response<InspectDealResponse | ErrorResponse>,
    ): Promise<Response> => {
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
        return res.json(result as InspectDealResponse);
      } catch (error) {
        logger.error('Failed to inspect deal', { error });
        return res.status(502).json({
          error: error instanceof Error ? error.message : 'Failed to inspect deal',
        });
      }
    },
  );

  router.post(
    '/agents/chat/:chatId/deal/reject',
    async (
      req: Request<{ chatId: string }, {}, DealRejectRequest>,
      res: Response<GetChatResponse | ErrorResponse>,
    ): Promise<Response> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return res;
      if (isDealLocked(thread, res)) return res;

      const proposalMessageID = req.body?.proposalMessageID;
      if (typeof proposalMessageID !== 'number') {
        return res.status(400).json({ error: 'proposalMessageID (number) is required' });
      }
      const content = req.body?.content?.trim() || 'The deal was rejected.';

      try {
        await withThreadLock(thread, async () => {
          await appendDealReject(thread, audienceID(thread), content, proposalMessageID);
          await mirrorDealRowsBestEffort(thread);
        });
        return res.json({ ...thread, ...enrichChat(thread) });
      } catch (error) {
        if (error instanceof ThreadBusyError) {
          return res.status(409).json({
            error: 'A reply is already being generated for this conversation. Please wait for it to finish.',
          });
        }
        logger.error('Failed to append deal-reject', { error });
        return res.status(502).json({
          error: error instanceof Error ? error.message : 'Failed to append deal-reject',
        });
      }
    },
  );

  router.post(
    '/agents/chat/:chatId/deal/accept',
    async (
      req: Request<{ chatId: string }, {}, DealAcceptRequest>,
      res: Response<GetChatResponse | ErrorResponse>,
    ): Promise<Response> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return res;
      if (isDealLocked(thread, res)) return res;
      if (typeof req.body?.proposalMessageID !== 'number') {
        return res.status(400).json({ error: 'proposalMessageID (number) is required' });
      }

      const accepterID = audienceID(thread);
      try {
        await withThreadLock(thread, async () => {
          await requireCurrentOpenProposal(thread, req.body.proposalMessageID, accepterID);
          await enactAgentDeal(req.body.proposalMessageID, { accepterID });
          await mirrorDealRowsBestEffort(thread);
        });
        return res.json({ ...thread, ...enrichChat(thread) });
      } catch (error) {
        if (error instanceof ThreadBusyError) {
          return res.status(409).json({
            error: 'A reply is already being generated for this conversation. Please wait for it to finish.',
          });
        }
        try {
          await requireCurrentOpenProposal(thread, req.body.proposalMessageID, accepterID);
        } catch (conflict) {
          return res.status(409).json({
            error: conflict instanceof Error
              ? conflict.message
              : 'Proposal is no longer open for acceptance',
          });
        }
        logger.error('Failed to enact deal', { error });
        return res.status(502).json({
          error: error instanceof Error ? error.message : 'Failed to enact deal',
        });
      }
    },
  );

  router.get(
    '/agents/chat/:chatId/deals',
    async (
      req: Request<{ chatId: string }>,
      res: Response<DealMessagesResponse | ErrorResponse>,
    ): Promise<Response> => {
      const thread = resolveDealThread(req.params.chatId, res);
      if (!thread) return res;
      try {
        const messages = await readDealMessages(thread.player1ID, thread.player2ID);
        return res.json({ messages: messages as DealMessagesResponse['messages'] });
      } catch (error) {
        logger.error('Failed to read deal messages', { error });
        return res.status(502).json({
          error: error instanceof Error ? error.message : 'Failed to read deal messages',
        });
      }
    },
  );

  return router;
}
