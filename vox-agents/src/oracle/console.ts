/**
 * @module oracle/console
 *
 * CLI entry point for Oracle experiments.
 * Dynamically imports user experiment scripts, runs them through the retrieve/replay
 * pipeline, and handles graceful stop (Ctrl+A) and immediate shutdown (Ctrl+C).
 */

import path from 'node:path';
import * as readline from 'node:readline';
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { sqliteExporter } from '../instrumentation.js';
import { processManager } from '../agents/runtime/process-manager.js';
import { createLogger } from '../utils/logger.js';
import { startWebServer } from '../web/server.js';
import { runReplay } from './replayer.js';
import { runRetrieve } from './retriever.js';
import type { OracleConfig, RetrievedRow } from './types.js';

const logger = createLogger('OracleCLI');

const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c' },
    outputDir: { type: 'string', short: 'o' },
    telemetryDir: { type: 'string', short: 't' },
    targetAgent: { type: 'string' },
    agentType: { type: 'string' },
    retrievalName: { type: 'string' },
    retrieve: { type: 'boolean' },
    replay: { type: 'boolean' },
    forceReplay: { type: 'boolean' },
    batch: { type: 'boolean' },
  },
  strict: false,
  allowPositionals: false,
});

let rl: readline.Interface | null = null;

let shuttingdownAfter = false;

/** Resolves an experiment script path from the CLI's flexible config argument. */
function resolveExperimentPath(input: string): string {
  if (path.isAbsolute(input)) return input;
  if (input.includes('/') || input.includes('\\')) return path.resolve(process.cwd(), input);
  return path.resolve(process.cwd(), 'experiments', input);
}

/** Prints Oracle CLI usage through the application logger. */
function printUsage(): void {
  logger.info([
    'Usage: npm run oracle -- -c <experiment-script> [options]',
    '',
    'Options:',
    '  --config, -c        Experiment script filename or path (required)',
    '  --outputDir, -o     Override output directory',
    '  --telemetryDir, -t  Override telemetry directory',
    '  --targetAgent       Override target agent name',
    '  --agentType         Override agent type',
    '  --retrievalName     Override retrieval directory name (share retrieved data across experiments)',
    '  --retrieve          Retrieve only (extract raw prompts from telemetry, no LLM)',
    '  --replay            Replay only (load retrieved JSONs, apply modifyPrompt, run LLM)',
    '  --forceReplay       Ignore existing replay trail JSON cache and rerun LLM calls',
    '  --batch             Use OpenAI Batch API for ~50% cost savings (openai/openai-compatible only)',
    '',
    'Modes:',
    '  (default)     Both retrieve + replay in sequence',
    '  --retrieve    Extracts raw prompts → {experimentDir}/retrieved/*.json',
    '  --replay      Loads *.json → applies modifyPrompt → runs LLM → results CSV',
    '',
    'Examples:',
    '  npm run oracle -- -c nuke-real-world.js',
    '  npm run oracle -- -c nuke-real-world.js --retrieve',
    '  npm run oracle -- -c nuke-real-world.js --replay',
    '  npm run oracle -- -c nuke-real-world.js -o temp/oracle-v2 -t telemetry/custom',
    '',
    'Press Ctrl+A to stop once admitted work drains, or press it again to cancel that stop.',
    'See docs/oracle.md for full documentation.',
  ].join('\n'));
}

/** Loads and combines the experiment script with supported CLI overrides. */
async function loadOracleConfig(): Promise<OracleConfig> {
  if (typeof values.config !== 'string' || !values.config) {
    printUsage();
    throw new Error('An Oracle experiment script is required.');
  }

  const scriptPath = resolveExperimentPath(values.config);
  logger.info(`Loading experiment: ${scriptPath}`);
  const scriptUrl = pathToFileURL(scriptPath).href;
  const module = await import(scriptUrl);
  const experimentConfig: OracleConfig = module.default;

  if (!experimentConfig || !experimentConfig.csvPath || !experimentConfig.experimentName || !experimentConfig.modifyPrompt) {
    throw new Error('Experiment script must export a default OracleConfig with csvPath, experimentName, and modifyPrompt.');
  }

  const cliOverrides = Object.fromEntries(
    (['outputDir', 'telemetryDir', 'targetAgent', 'agentType', 'retrievalName'] as const)
      .filter(key => values[key] !== undefined)
      .map(key => [key, values[key]]),
  ) as Partial<OracleConfig>;

  return {
    ...experimentConfig,
    ...cliOverrides,
    ...(values.forceReplay === true ? { readCache: false } : {}),
    ...(values.batch === true ? { batch: true } : {}),
  };
}

// Register shutdown hooks with processManager
processManager.register('terminal', async () => {
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
  }
  if (rl) rl.close();
});
processManager.register('telemetry', async () => {
  await sqliteExporter.forceFlush();
  await setTimeout(1000);
});

// Web UI
await startWebServer();

// Setup readline interface for keyboard input
rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true
});

// Enable raw mode to capture Ctrl key combinations
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

// Listen for keypress events
process.stdin.on('data', (key) => {
  // Ctrl+A is ASCII code 1 - stop admitting new work once the current work drains
  if (key[0] === 1) {
    if (!shuttingdownAfter) {
      shuttingdownAfter = true;
      logger.info('Ctrl+A pressed: Will stop after current work completes');
    } else {
      shuttingdownAfter = false;
      logger.info('Ctrl+A pressed again: Cancelled shutdown after current work');
    }
  }
  // Ctrl+C is ASCII code 3 - immediate shutdown via processManager
  else if (key[0] === 3) {
    processManager.shutdown('SIGINT');
  }
});

/**
 * Main entry point.
 * Runs the selected Oracle phases, then shuts down through processManager.
 * Each phase reports its own counts and artifact paths, so this only reports the verdict.
 */
async function main() {
  try {
    const config = await loadOracleConfig();
    logger.info(`Starting experiment: ${config.experimentName}`);

    const retrieveOnly = values.retrieve === true && values.replay !== true;
    const replayOnly = values.replay === true && values.retrieve !== true;
    const shouldStop = () => shuttingdownAfter;

    let rows: RetrievedRow[] | undefined;
    if (!replayOnly) {
      rows = await runRetrieve(config, true, shouldStop);
    }

    // A stop requested during retrieve skips replay rather than replaying a partial row set.
    if (!retrieveOnly && !shuttingdownAfter) {
      await runReplay(config, rows, shouldStop);
    }

    logger.info(shuttingdownAfter
      ? `Experiment "${config.experimentName}" stopped after Ctrl+A.`
      : `Experiment "${config.experimentName}" complete.`);
  } catch (error) {
    logger.error('Experiment failed:', error);
    process.exit(1);
  } finally {
    await processManager.shutdown('main-complete');
  }
}

// Run the main function
main();
