/**
 * @module web/chat/discovery
 *
 * Registers agent discovery and chat-thread lifecycle routes.
 */

import { Router, type Request, type Response } from 'express';
import { agentRegistry } from '../../infra/agent-registry.js';
import { pacingInterruptionRegistry } from '../../strategist/pacing/registry.js';
import type {
  AgentInfo,
  CreateChatRequest,
  CreateChatResponse,
  DeleteChatResponse,
  ErrorResponse,
  GetChatResponse,
  ListAgentsResponse,
  ListChatsResponse,
  ListPacingInterruptionsResponse,
} from '../../types/index.js';
import { createLogger } from '../../utils/logger.js';
import { sendError } from '../http-utils.js';
import { enrichChat } from './enrichment.js';
import {
  ChatOpenError,
  openDiplomacyChat,
  openOrdinaryChat,
} from './factory.js';
import { chatThreadStore } from './store.js';

const logger = createLogger('webui:chat-discovery');

/** Register discovery, open, read, list, and delete routes for Web chats. */
export function createAgentDiscoveryRoutes(): Router {
  const router = Router();

  router.get(
    '/agents',
    (_req: Request, res: Response<ListAgentsResponse | ErrorResponse>): void => {
      try {
        const agents: AgentInfo[] = agentRegistry.getAll().map((agent) => ({
          name: agent.name,
          displayName: agent.displayName,
          description: agent.description,
          tags: agent.tags || [],
          modelSize: agent.modelSize,
          diplomacyOnly: agent.diplomacyOnly,
          offeredInSetup: agent.offeredInSetup,
        }));
        res.json({ agents });
      } catch (error) {
        logger.error('Failed to list agents', { error });
        sendError(res, 500, 'Failed to list agents');
      }
    },
  );

  router.get(
    '/agents/pacing-interruptions',
    (_req: Request, res: Response<ListPacingInterruptionsResponse | ErrorResponse>): void => {
      try {
        const interruptions = pacingInterruptionRegistry.getAll().map((strategy) => ({
          name: strategy.name,
          label: strategy.label,
          description: strategy.description,
        }));
        res.json({ interruptions });
      } catch (error) {
        logger.error('Failed to list pacing interruptions', { error });
        sendError(res, 500, 'Failed to list pacing interruptions');
      }
    },
  );

  router.post(
    '/agents/chat',
    async (
      req: Request<object, object, CreateChatRequest>,
      res: Response<CreateChatResponse | ErrorResponse>,
    ): Promise<void> => {
      try {
        const thread = req.body.mode === 'diplomacy'
          ? await openDiplomacyChat(req.body)
          : await openOrdinaryChat(req.body);
        res.json({ ...thread, ...enrichChat(thread) });
      } catch (error) {
        if (error instanceof ChatOpenError) {
          sendError(res, error.status, error.message);
          return;
        }
        logger.error('Failed to create session', { error });
        sendError(res, 500, 'Failed to create session');
      }
    },
  );

  router.get(
    '/agents/chats',
    (_req: Request, res: Response<ListChatsResponse | ErrorResponse>): void => {
      try {
        res.json({ chats: chatThreadStore.list() });
      } catch (error) {
        logger.error('Failed to list chat threads', { error });
        sendError(res, 500, 'Failed to list chat threads');
      }
    },
  );

  router.get(
    '/agents/chat/:chatId',
    async (
      req: Request<{ chatId: string }>,
      res: Response<GetChatResponse | ErrorResponse>,
    ): Promise<void> => {
      try {
        const thread = await chatThreadStore.read(req.params.chatId);
        if (!thread) {
          sendError(res, 404, 'Chat thread not found');
          return;
        }
        res.json({ ...thread, ...enrichChat(thread) });
      } catch (error) {
        logger.error('Failed to get chat thread', { error });
        sendError(res, 500, 'Failed to get chat thread');
      }
    },
  );

  router.delete(
    '/agents/chat/:chatId',
    async (
      req: Request<{ chatId: string }>,
      res: Response<DeleteChatResponse | ErrorResponse>,
    ): Promise<void> => {
      try {
        const deleted = await chatThreadStore.delete(req.params.chatId);
        if (!deleted) {
          sendError(res, 404, 'Chat thread not found');
          return;
        }
        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to delete chat thread', { error });
        sendError(res, 500, 'Failed to delete chat thread');
      }
    },
  );

  return router;
}
