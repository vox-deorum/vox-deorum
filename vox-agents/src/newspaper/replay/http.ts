import express, { type Express, type ErrorRequestHandler, type RequestHandler } from 'express';
import { ZodError } from 'zod';
import { sendError } from '../../web/http-utils.js';
import { errorMessage } from '../../utils/errors.js';
import { ReplaySessionError, type ReplaySession } from './session.js';

type ReplayHandlers = Pick<ReplaySession, 'configure' | 'getState' | 'evidence' | 'advance'>;

/** Adapt a session operation to the common JSON error boundary. */
function reply(operation: (body: unknown) => Promise<unknown>): RequestHandler {
  return async (req, res) => {
    try { res.json(await operation(req.body)); }
    catch (error) {
      sendError(res, error instanceof ReplaySessionError ? error.status : error instanceof ZodError ? 400 : 500, errorMessage(error));
    }
  };
}

/** Mount replay's own parser and handlers before newspaper API and asset fallbacks. */
export function mountReplayRoutes(app: Express, session: () => ReplayHandlers): void {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  router.get('/', reply(() => session().getState()));
  router.put('/', reply(body => session().configure(body)));
  router.post('/evidence', reply(() => session().evidence()));
  router.post('/advance', reply(() => session().advance()));
  /** Return parser failures through the same JSON envelope as session failures. */
  const parserError: ErrorRequestHandler = (error, _req, res, _next) => {
    sendError(res, error.type === 'entity.too.large' ? 413 : 400, errorMessage(error));
  };
  router.use(parserError);
  app.use('/api/newspaper/replay', router);
}
