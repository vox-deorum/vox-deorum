/** Start the production stdio transport with external game managers isolated. */
import { config } from '../../src/utils/config.js';
import { startStdioServer } from '../../src/stdio.js';
import { exitWhenClientCloses, isolateExternalManagers } from './server-process.js';

config.transport.type = 'stdio';
config.bridgeService.eventPipe.enabled = false;
await isolateExternalManagers();

exitWhenClientCloses(await startStdioServer(false));
