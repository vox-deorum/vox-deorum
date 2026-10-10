/**
 * @module web/chat/message
 *
 * Adapts the transport-neutral chat turn runner to Express SSE.
 */

import { Router, type Request, type Response } from 'express';
import type { ChatStreamSink, ErrorResponse } from '../../types/index.js';
import { sendError } from '../http-utils.js';
import { runChatTurn } from './turn.js';

/** Register the unified text and deal message route. */
export function createAgentMessageRoutes(): Router {
  const router = Router();

  router.post(
    '/agents/message',
    async (req: Request<object, object, unknown>, res: Response<ErrorResponse>): Promise<void> => {
      let connected = false;

      /** Write one SSE event using the route's only wire-format adapter. */
      const sendEvent = (event: string, data: unknown): void => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // The transport-neutral sink carries an internal `rows` field on every terminal event (the exact
      // durable transcript rows the turn committed). That is for the in-game panel, which renders
      // authoritative rows; the Web client reduces its board from `deal` / `deals` and its transcript
      // from the stream plus a refresh. Stripping `rows` here keeps the public Web event contract
      // byte-for-byte unchanged as the internal contract grows.
      const sink: ChatStreamSink = {
        connected({ rows: _rows, ...data }) {
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
        error({ rows: _rows, ...data }) {
          sendEvent('error', data);
        },
        done({ rows: _rows, ...data }) {
          sendEvent('done', data);
        },
        onDisconnect(callback) {
          res.on('close', callback);
        },
      };

      const rejection = await runChatTurn(req.body, sink);
      if (rejection) {
        sendError(res, rejection.status, rejection.error);
        return;
      }

      if (connected) res.end();
    },
  );

  return router;
}
