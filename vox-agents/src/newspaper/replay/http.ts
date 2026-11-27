import express, { type Express, type ErrorRequestHandler, type RequestHandler } from 'express';
import { ZodError } from 'zod';
import { sendError } from '../../web/http-utils.js';
import { errorMessage } from '../../utils/errors.js';
import type { ReplayAdvanceSummaryResponse } from '../contracts/replay.js';
import { latestRecording } from './recordings.js';
import { ReplaySessionError, type ReplaySession } from './session.js';

type ReplayHandlers = Pick<ReplaySession, 'configure' | 'getState' | 'evidence' | 'advance' | 'listIssues' | 'getIssue' | 'coverage' | 'checkCoverage' | 'setVote' | 'setPreferences'>;

/** Adapt a session operation to the common JSON error boundary. */
function reply(operation: (body: unknown, req: express.Request) => Promise<unknown>): RequestHandler {
  return async (req, res) => {
    try { res.json(await operation(req.body, req)); }
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
  router.get('/latest-recording', reply(async () => ({ databasePath: await latestRecording() })));
  router.put('/', reply(body => session().configure(body)));
  router.post('/evidence', reply(body => session().evidence(body)));
  router.post('/advance', reply(async (body, req) => {
    const result = await session().advance(body, true);
    if (req.query.view !== 'summary') return result;
    return {
      session: result.session,
      check: result.check && {
        status: result.check.status,
        reason: result.check.reason,
        issueId: result.check.issue?.issueId,
      },
    } satisfies ReplayAdvanceSummaryResponse;
  }));
  router.get('/issues', reply((_body, req) => session().listIssues(queryScope(req))));
  router.get('/issues/:issueId', reply((_body, req) => session().getIssue(String(req.params.issueId), queryScope(req))));
  router.get('/coverage', reply((_body, req) => session().coverage(queryScope(req))));
  router.get('/coverage/:turn', reply(async (_body, req) => {
    const turn = String(req.params.turn);
    if (!/^\d+$/.test(turn)) throw new ReplaySessionError('Expected a whole-number cutoff turn.', 400);
    return session().checkCoverage(Number(turn), queryScope(req));
  }));
  router.put('/votes', reply(body => session().setVote(body)));
  router.put('/preferences', reply(body => session().setPreferences(body)));
  /** Return parser failures through the same JSON envelope as session failures. */
  const parserError: ErrorRequestHandler = (error, _req, res, _next) => {
    sendError(res, error.type === 'entity.too.large' ? 413 : 400, errorMessage(error));
  };
  router.use(parserError);
  app.use('/api/newspaper/replay', router);
}

/** Convert only a well-formed integer receiver, leaving invalid query values for schema rejection. */
function queryScope(req: express.Request): unknown {
  const receiver = req.query.receiverPlayerID;
  return {
    ...(req.query.runId === undefined ? {} : { runId: req.query.runId }),
    ...(receiver === undefined ? {} : { receiverPlayerID: typeof receiver === 'string' && /^\d+$/.test(receiver) ? Number(receiver) : receiver }),
  };
}
