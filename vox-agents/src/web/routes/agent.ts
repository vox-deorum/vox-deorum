/**
 * @module web/routes/agent
 *
 * Compatibility entry point that composes the agent and chat route groups.
 */

import { Router } from 'express';
import { createAgentDealStatusRoutes } from '../chat/deal.js';
import { createAgentDiscoveryRoutes } from '../chat/discovery.js';
import { createAgentMessageRoutes } from '../chat/message.js';

/** Create the complete agent API router under the established paths. */
export function createAgentRoutes(): Router {
  const router = Router();
  router.use(createAgentDiscoveryRoutes());
  router.use(createAgentMessageRoutes());
  router.use(createAgentDealStatusRoutes());
  return router;
}
