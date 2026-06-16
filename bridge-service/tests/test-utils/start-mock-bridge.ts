#!/usr/bin/env tsx
/**
 * Start the real Bridge Service against an in-process mock DLL.
 *
 * This boots the production Express server (`src/index.ts` → `startServer()`),
 * but first stands up a {@link MockDLLServer} on the same IPC pipe the bridge's
 * `dllConnector` connects to. The result is a fully real bridge — same routes,
 * same SSE, same Lua/external plumbing — that needs **no Civilization V game**.
 *
 * It is the shared "mock bottom" used by the `real` test tiers of mcp-server and
 * vox-agents: those packages spawn `npm run start:mock` here and point their
 * stack at `http://127.0.0.1:<PORT>`.
 *
 * Usage: `cross-env USE_MOCK=true tsx tests/test-utils/start-mock-bridge.ts`
 *        (exposed as `npm run start:mock`).
 */

// Pin env BEFORE importing anything that reads config at module load. Both the
// mock DLL factory and the bridge config read `gamepipe_ID` first, so setting it
// here guarantees the server and the mock share one pipe regardless of defaults.
process.env.gamepipe_ID = process.env.gamepipe_ID || 'vox-deorum-bridge';
process.env.PORT = process.env.PORT || '5000';
process.env.EVENTPIPE_ENABLED = process.env.EVENTPIPE_ENABLED || 'false';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

import { createLogger } from '../../src/utils/logger.js';
import { createMockDLLServer, type MockDLLServer } from './mock-dll-server.js';

const logger = createLogger('StartMockBridge');

async function main(): Promise<void> {
  logger.info(`Starting mock DLL on pipe "${process.env.gamepipe_ID}"...`);
  const mockDLL: MockDLLServer = await createMockDLLServer({
    id: process.env.gamepipe_ID!,
    simulateDelay: false,
    autoEvents: false,
  });
  logger.info('Mock DLL ready; booting real Bridge Service...');

  // Importing index.js does not auto-start (argv[1] is this launcher, not
  // index.js), so we drive startServer() explicitly after the mock is listening.
  const { startServer } = await import('../../src/index.js');
  await startServer();

  const shutdown = async () => {
    logger.info('Stopping mock DLL...');
    await mockDLL.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGBREAK', shutdown);
}

main().catch((error) => {
  logger.error('Failed to start mock bridge:', error);
  process.exit(1);
});
