/**
 * @module telepathist/console
 *
 * Console entry point for the Telepathist workflow.
 * Runs bootstrapping (turn/phase summarization) against a telemetry database
 * and optionally streams the agent's greeting response.
 *
 * Usage:
 *   npm run telepathist -- -d <database-path> [-a <agent-name>] [-p]
 *
 * Options:
 *   -d, --database   Path to the telemetry .db file (required, or first positional arg)
 *   -a, --agent      Agent name (default: talkative-telepathist)
 *   -p, --prepare    Preparation only: run summarization then exit without full agent execution
 */

import { sqliteExporter } from "../instrumentation.js";
import { createLogger } from "../utils/logger.js";
import { parseArgs } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { VoxContext } from '../agents/runtime/vox-context.js';
import {
  createTelepathistParameters,
  TelepathistParameters
} from './telepathist-parameters.js';
import {
  parseDatabaseIdentifier,
} from '../agents/telemetry/identifier-parser.js';
import { contextRegistry } from '../agents/runtime/context-registry.js';
import { agentRegistry } from '../agents/runtime/agent-registry.js';
import { StreamingEventCallback, EnvoyThread } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import { VoxSpanExporter } from "../agents/telemetry/vox-exporter.js";
import { startWebServer } from "../web/server.js";
import { processManager } from "../agents/runtime/process-manager.js";
import { ensureModelsResolved, selectModelReference } from '../agents/models/resolution.js';

const logger = createLogger('Telepathist');

// Parse command line arguments
const { values, positionals } = parseArgs({
  options: {
    database: {
      type: 'string',
      short: 'd'
    },
    agent: {
      type: 'string',
      short: 'a',
      default: 'talkative-telepathist'
    },
    prepare: {
      type: 'boolean',
      short: 'p',
      default: false
    }
  },
  strict: false,
  allowPositionals: true
});

const rawDatabasePath = (values.database as string) || positionals[0];
const agentName = values.agent as string;
const prepareOnly = values.prepare as boolean;

if (!rawDatabasePath) {
  logger.error('Database path is required. Usage: telepathist -d <database-path> [-a <agent>] [-p]');
  process.exit(1);
}

// Fail fast on a diplomacy-only agent (e.g. the diplomat): the telepathist console always builds a
// non-diplomacy thread, so such an agent has no counterpart here. VoxContext.execute enforces this
// invariant for every entry point, but checking up front gives the operator a clear message before
// the database, web server, and context are spun up.
const agentDef = agentRegistry.get(agentName);
if (agentDef?.diplomacyOnly) {
  logger.error(`Agent '${agentName}' only runs in diplomacy mode and cannot be voiced in a telepathist console session. Choose an observer/telepathist agent (e.g. talkative-telepathist).`);
  process.exit(1);
}

const databasePath = path.resolve(path.join("telemetry", rawDatabasePath));

// Register shutdown hooks with processManager
processManager.register('contexts', async () => {
  await contextRegistry.shutdownAll();
});
processManager.register('telemetry', async () => {
  await sqliteExporter.forceFlush();
  await setTimeout(1000);
});

/**
 * Main entry point.
 * Bootstraps the telepathist agent against a telemetry database.
 */
async function main() {
  // Verify the selected agent's model before opening the web server or databases.
  await ensureModelsResolved([selectModelReference(agentName, agentDef?.modelSize)]);
  await startWebServer();

  // Parse database identifier for game/player info
  const identifierInfo = parseDatabaseIdentifier(databasePath);
  logger.info(`Opening telemetry database: ${databasePath}`, {
    gameID: identifierInfo.gameID,
    playerID: identifierInfo.playerID
  });

  // Create parameters (opens DBs, extracts identity, queries available turns)
  const params = await createTelepathistParameters(databasePath, identifierInfo);
  // Create context
  const contextId =  `${identifierInfo.gameID}-telepath-${identifierInfo.playerID}`;
  VoxSpanExporter.getInstance().createContext(contextId, "telepathist");
  const voxContext = new VoxContext<TelepathistParameters>({}, contextId);
  // Transfer ownership of the seat parameters to the context; shutdown() closes them.
  voxContext.setBaseParameters(params);

  // Load cached MCP tool metadata (for markdownConfig formatting) and register agent tools.
  // No live MCP connection needed — telepathist reads from the telemetry database only.
  voxContext.loadToolCache();
  if (!prepareOnly) {
    voxContext.registerAgentTools();
  }

  // Stream non-LLM progress to the logger. Carried into the run below so preparation and the
  // top-level execution (and the per-turn preparation roots) all reach the same sink.
  const streamProgress = (message: string) => {
    logger.info(message);
  };

  const streamCallback: StreamingEventCallback = {
    OnChunk: ({ chunk }) => {
      if (chunk.type === 'text-delta') {
        logger.info(chunk.text);
      }
    }
  };

  // Build thread with Initialize message to trigger bootstrapping
  const thread: EnvoyThread = {
    id: uuidv4(),
    // The telepathist voices this player; its role descriptor is the agent name.
    agent: identifierInfo.playerID,
    gameID: identifierInfo.gameID,
    // Ordered pair: observer (-1) sorts to player1; the voiced civ is player2.
    player1ID: -1,
    player2ID: identifierInfo.playerID,
    player1Role: 'observer',
    player2Role: agentName,
    diplomacy: false,
    contextType: 'database',
    contextId,
    databasePath,
    messages: [{
      message: { role: 'user', content: '{{{Initialize}}}' },
      metadata: { datetime: new Date(), turn: params.turn }
    }]
  };

  logger.info(`Bootstrapping ${agentName} for ${params.leaderName} of ${params.civilizationName}`, {
    turns: params.availableTurns.length,
    lastTurn: params.turn,
    prepareOnly
  });

  // One root for the whole bootstrap: the Initialize message triggers turn/phase preparation
  // (which fans out its own per-turn roots) and then a greeting. The run carries the progress
  // sink so preparation and execution share it.
  await voxContext.withRun({ streamProgress }, () =>
    voxContext.execute(agentName, thread, streamCallback)
  );

  logger.info('Bootstrapping complete');

  // Clean up via processManager (calls contextRegistry.shutdownAll → context.shutdown → params.close)
  await processManager.shutdown('complete');
}

main().catch((error) => {
  // Preflight now runs before the web server, so a bad model reference must report
  // itself here rather than surfacing as an unhandled rejection with no dashboard.
  logger.error('Telepathist failed to start:', error);
  process.exit(1);
});
