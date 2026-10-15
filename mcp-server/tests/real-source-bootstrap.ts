/** Start the source MCP server after installing the controlled real-tier DB. */
import { configureGameDatabase } from './fixtures/game-database.js';
import { configureKnowledgeManager } from './fixtures/knowledge.js';
import { exitWhenClientCloses } from './fixtures/server-process.js';
import { gameDatabase, knowledgeManager } from '../src/server.js';
import { config } from '../src/utils/config.js';
import { startStdioServer } from '../src/stdio.js';

config.transport.type = 'stdio';
config.bridgeService.eventPipe.enabled = false;
if (process.env.EVENTPIPE_NAME) config.bridgeService.eventPipe.name = process.env.EVENTPIPE_NAME;
const cleanupGameDatabase = await configureGameDatabase(gameDatabase);
const cleanupKnowledge = await configureKnowledgeManager(knowledgeManager);
const closeServer = await startStdioServer(false);
exitWhenClientCloses(async () => {
  await closeServer();
  await cleanupKnowledge();
  await cleanupGameDatabase();
});
