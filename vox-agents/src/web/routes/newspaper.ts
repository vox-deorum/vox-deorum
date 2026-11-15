/** Expose sample delivery through the existing dashboard's debug API. */
import { Router } from 'express';
import { sendError } from '../http-utils.js';
import { errorMessage } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import type { ShowNewspaperResponse } from '../../types/index.js';

const logger = createLogger('Newspaper', 'webui');

/** Report success only after the game acknowledges opening the sample reader. */
export function createNewspaperDebugRoutes(showSample: () => Promise<ShowNewspaperResponse>): Router {
  const router = Router();
  router.post('/newspaper/show', async (_req, res) => {
    try {
      res.json(await showSample());
    } catch (error) {
      logger.error('Failed to show the newspaper', { error });
      sendError(res, 503, errorMessage(error));
    }
  });
  return router;
}
