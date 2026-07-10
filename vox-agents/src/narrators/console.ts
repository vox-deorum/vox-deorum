/**
 * @module narrators/console
 *
 * Entry point for the Narrator pipeline.
 * Each narrator stage runs as a single-shot batch — load config, instantiate
 * the matching session class, run start(), exit. No game loop, no readline.
 *
 * Usage:
 *   npm run narrator -- --stage <name> --config <file> [--workspace <path>]
 *
 * Stages: assemble | select | script | voice | video
 */

import { sqliteExporter } from "../instrumentation.js";
import { createLogger } from "../utils/logger.js";
import { loadConfigFromFile, getConfigsDir } from "../utils/config.js";
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { processManager } from "../infra/process-manager.js";
import { VoxSession } from "../infra/vox-session.js";
import { AssembleSession } from "./sessions/assemble-session.js";
import type { AssembleConfig, NarratorStageConfig } from "./types.js";

const logger = createLogger('Narrator');

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    stage: { type: 'string', short: 's' },
    config: { type: 'string', short: 'c' },
    workspace: { type: 'string', short: 'w' },
  },
  strict: false,
  allowPositionals: false,
});

const stage = values.stage as string | undefined;
const configFile = values.config as string | undefined;
const workspaceOverride = values.workspace as string | undefined;

if (!stage) {
  logger.error('Missing required --stage argument (assemble|select|script|voice|video)');
  process.exit(1);
}
if (!configFile) {
  logger.error('Missing required --config argument');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

// Resolve config path: absolute paths used as-is, relative paths join configsDir.
const resolvedConfigPath = path.isAbsolute(configFile)
  ? configFile
  : path.join(getConfigsDir(), configFile);

// Default config — provides safe values for SessionConfig base fields.
// Stage-specific required fields (workspace, gameID, recordingDir for assemble)
// must come from the config file or CLI overrides. Validated after the merge.
const defaultConfig = {
  name: path.basename(configFile, '.json'),
  type: `narrator-${stage}` as NarratorStageConfig['type'],
  autoPlay: false,
  gameMode: 'wait' as const,
  workspace: '',
} as NarratorStageConfig;

const cmdOverrides: Partial<NarratorStageConfig> = {
  // Force the type to match --stage so the discriminated union is correct.
  type: `narrator-${stage}` as NarratorStageConfig['type'],
};
if (workspaceOverride) {
  cmdOverrides.workspace = workspaceOverride;
}

const sessionConfig = loadConfigFromFile<NarratorStageConfig>(
  resolvedConfigPath,
  defaultConfig,
  cmdOverrides,
);

if (!sessionConfig.workspace) {
  logger.error('Config is missing required "workspace" field (and no --workspace override given)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Stage routing
// ---------------------------------------------------------------------------

/**
 * Map a short stage name to its session class.
 * Add new cases here as Stages 2–5 are implemented.
 */
function createStageSession(stageName: string, config: NarratorStageConfig): VoxSession {
  switch (stageName) {
    case 'assemble':
      return new AssembleSession(config as AssembleConfig);
    // case 'select':  return new SelectSession(config as SelectConfig);
    // case 'script':  return new ScriptSession(config as ScriptConfig);
    // case 'voice':   return new VoiceSession(config as VoiceConfig);
    // case 'video':   return new VideoSession(config as VideoConfig);
    default:
      throw new Error(`Unknown narrator stage: ${stageName}`);
  }
}

// ---------------------------------------------------------------------------
// Shutdown hooks
// ---------------------------------------------------------------------------

let session: VoxSession | null = null;

processManager.register('session', async () => {
  if (session) await session.stop();
});
processManager.register('telemetry', async () => {
  await sqliteExporter.forceFlush();
  await setTimeout(1000);
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  logger.info(`Narrator stage '${stage}' starting`, {
    config: resolvedConfigPath,
    workspace: sessionConfig.workspace,
  });
  try {
    session = createStageSession(stage!, sessionConfig);
    await session.start();
    logger.info(`Narrator stage '${stage}' completed`);
  } catch (error) {
    logger.error(`Narrator stage '${stage}' failed:`, error);
    process.exit(1);
  } finally {
    await processManager.shutdown('main-complete');
  }
}

main();
