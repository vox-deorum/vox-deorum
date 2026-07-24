/**
 * @module oracle/console
 *
 * CLI entry point for Oracle experiments.
 * Dynamically imports user experiment scripts and runs them through the two-phase pipeline.
 *
 * Usage:
 *   npm run oracle -- -c nuke-real-world.js              # retrieve + replay (default)
 *   npm run oracle -- -c nuke-real-world.js --retrieve   # retrieve only (no LLM)
 *   npm run oracle -- -c nuke-real-world.js --replay     # replay only (load saved JSONs)
 *   npm run oracle -- -c nuke-real-world.js --forceReplay # ignore cached replay trails
 *   npm run oracle -- -c nuke-real-world.js -o temp/oracle-v2 -t telemetry/custom
 */

import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { createLogger } from '../utils/logger.js';
import { runRetrieve } from './retriever.js';
import { runReplay } from './replayer.js';
import type { OracleConfig } from './types.js';
import { startWebServer } from '../web/server.js';
import { sqliteExporter } from '../instrumentation.js';
import { processManager } from '../infra/process-manager.js';

const logger = createLogger('OracleCLI');

processManager.register('telemetry', async () => {
  await sqliteExporter.forceFlush();
  await setTimeout(1000);
});

const { values } = parseArgs({
  options: {
    config:       { type: 'string',  short: 'c' },
    outputDir:    { type: 'string',  short: 'o' },
    telemetryDir: { type: 'string',  short: 't' },
    targetAgent:    { type: 'string' },
    agentType:      { type: 'string' },
    retrievalName:  { type: 'string' },
    retrieve:       { type: 'boolean' },
    replay:         { type: 'boolean' },
    forceReplay:    { type: 'boolean' },
    batch:          { type: 'boolean' },
  },
  strict: false,
  allowPositionals: false,
});

/**
 * Resolves an experiment script path.
 * - Absolute path -> use directly
 * - Path with directory separator -> resolve from cwd
 * - Bare filename -> resolve from experiments/ directory
 */
function resolveExperimentPath(input: string): string {
  if (path.isAbsolute(input)) return input;
  if (input.includes('/') || input.includes('\\')) return path.resolve(process.cwd(), input);
  return path.resolve(process.cwd(), 'experiments', input);
}

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
    'See docs/oracle.md for full documentation.',
  ].join('\n'));
}

async function main() {
  if (!values.config) {
    printUsage();
    process.exit(1);
  }

  const scriptPath = resolveExperimentPath(values.config as string);
  logger.info(`Loading experiment: ${scriptPath}`);

  try {
    const scriptUrl = pathToFileURL(scriptPath).href;
    const module = await import(scriptUrl);
    const experimentConfig: OracleConfig = module.default;

    if (!experimentConfig || !experimentConfig.csvPath || !experimentConfig.experimentName || !experimentConfig.modifyPrompt) {
      logger.error('Experiment script must export a default OracleConfig with csvPath, experimentName, and modifyPrompt.');
      process.exit(1);
    }

    // Merge CLI overrides into experiment config
    const cliOverrides = Object.fromEntries(
      (['outputDir', 'telemetryDir', 'targetAgent', 'agentType', 'retrievalName'] as const)
        .filter(k => values[k] !== undefined)
        .map(k => [k, values[k]])
    ) as Partial<OracleConfig>;

    const config: OracleConfig = {
      ...experimentConfig,
      ...cliOverrides,
      ...(values.forceReplay === true ? { readCache: false } : {}),
      ...(values.batch === true ? { batch: true } : {}),
    };

    const retrieveOnly = values.retrieve === true && values.replay !== true;
    const replayOnly   = values.replay === true   && values.retrieve !== true;

    await startWebServer();
    logger.info(`Starting experiment: ${config.experimentName}`);

    const retrieveBaseName = config.retrievalName ?? config.experimentName;

    if (retrieveOnly) {
      const rows = await runRetrieve(config, true);
      const errors = rows.filter(r => r.error).length;
      logger.info([
        `Experiment "${config.experimentName}" retrieve complete:`,
        `  ${rows.length - errors} rows retrieved`,
        `  ${errors} errors`,
        `  Retrieved JSONs: temp/oracle/${retrieveBaseName}/retrieved/`,
      ].join('\n'));
    } else if (replayOnly) {
      const results = await runReplay(config);
      const errors = results.filter(r => r.error).length;
      logger.info([
        `Experiment "${config.experimentName}" replay complete:`,
        `  ${results.length - errors} successful replays`,
        `  ${errors} errors`,
        `  Results: temp/oracle/${config.experimentName}-results.csv`,
        `  Trails: temp/oracle/${config.experimentName}/`,
        `  Telemetry: telemetry/oracle/${config.experimentName}.db`,
      ].join('\n'));
    } else {
      // Both: retrieve (saving to disk), then replay with in-memory rows
      const rows = await runRetrieve(config, true);
      const results = await runReplay(config, rows);
      const errors = results.filter(r => r.error).length;
      logger.info([
        `Experiment "${config.experimentName}" complete:`,
        `  ${results.length - errors} successful replays`,
        `  ${errors} errors`,
        `  Retrieved JSONs: temp/oracle/${retrieveBaseName}/retrieved/`,
        `  Results: temp/oracle/${config.experimentName}-results.csv`,
        `  Trails: temp/oracle/${config.experimentName}/`,
        `  Telemetry: telemetry/oracle/${config.experimentName}.db`,
      ].join('\n'));
    }
  } catch (error) {
    logger.error('Experiment failed:', error);
    process.exit(1);
  }
}

main();
