/**
 * @module web/chat/message
 *
 * Adapts the transport-neutral chat turn runner to Express SSE.
 */

import { Router, type Request, type Response } from 'express';
import type { ChatStreamSink, ChatTurnRequest } from '../../types/index.js';
import { runChatTurn } from './turn.js';

/** Register the unified text and deal message route. */
export function createAgentMessageRoutes(): Router {
  const router = Router();

  router.post(
    '/agents/message',
    async (req: Request<{}, {}, ChatTurnRequest>, res: Response): Promise<void> => {
      let connected = false;

      /** Write one SSE event using the route's only wire-format adapter. */
      const sendEvent = (event: string, data: unknown): void => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const sink: ChatStreamSink = {
        connected(data) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });
          connected = true;
          sendEvent('connected', data);
        },
        message(data) {
          sendEvent('message', data);
        },
        error(data) {
          sendEvent('error', data);
        },
        done(data) {
          sendEvent('done', data);
        },
        onDisconnect(callback) {
          res.on('close', callback);
        },
      };

      const rejection = await runChatTurn(req.body, sink);
      if (rejection) {
        res.status(rejection.status).json({ error: rejection.error });
        return;
      }

      if (connected) res.end();
    },
  );

  return router;
}
