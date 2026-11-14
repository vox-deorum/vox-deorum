/** Start the production stdio transport with external game managers isolated. */
import { configureGameDatabase } from './game-database.js';
import { gameDatabase } from '../../src/server.js';
import { config } from '../../src/utils/config.js';
import { startStdioServer } from '../../src/stdio.js';
import { exitWhenClientCloses, isolateExternalManagers } from './server-process.js';

config.transport.type = 'stdio';
config.bridgeService.eventPipe.enabled = false;
await isolateExternalManagers();
if (process.env.FIXTURE_LANGUAGE) await configureGameDatabase(gameDatabase, process.env.FIXTURE_LANGUAGE);

exitWhenClientCloses(await startStdioServer(false));
