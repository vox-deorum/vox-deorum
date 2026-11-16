import { knowledgeManager } from '../../src/server.js';
import type { KnowledgeStore } from '../../src/knowledge/store.js';
import { config } from '../../src/utils/config.js';
import { startStdioServer } from '../../src/stdio.js';
import { exitWhenClientCloses, isolateExternalManagers } from '../fixtures/server-process.js';
import { openEvidenceRecording } from './fixtures.js';

// Only the external managers are stubbed. Registration and stdio use the production paths.
config.transport.type = 'stdio';
config.bridgeService.eventPipe.enabled = false;
await isolateExternalManagers();
const db = openEvidenceRecording(process.env.NEWSPAPER_FIXTURE_DB!);
knowledgeManager.getStore = () => ({ getDatabase: () => db }) as KnowledgeStore;
/** Supply the live round after the fixture's completed evidence cutoff. */
knowledgeManager.getTurn = () => 11;
const close = await startStdioServer(false);
exitWhenClientCloses(async () => { await close(); await db.destroy(); });
