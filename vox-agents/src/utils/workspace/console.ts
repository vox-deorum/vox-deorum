/**
 * @module utils/workspace/console
 *
 * CLI entry point for seat workspace stores, which live inside seat telemetry databases.
 *
 * Usage:
 *   npm run workspace -- materialize <telemetryDb> <outDir> [commit]
 *
 * `materialize` copies one version of a seat store, head by default, out as ordinary files. The
 * output folder must be new or empty. The database is only read.
 */

import path from 'node:path';
import { createLogger } from '../logger.js';
import { errorMessage } from '../errors.js';
import { processManager } from '../../infra/process-manager.js';
import { WorkspaceStore } from './workspace-store.js';
import { diskSink, materialize } from './materialize.js';

const logger = createLogger('WorkspaceCLI');

/** Print usage through the application logger. */
function printUsage(): void {
  logger.info([
    'Usage: npm run workspace -- materialize <telemetryDb> <outDir> [commit]',
    '',
    '  telemetryDb  Seat telemetry database, such as telemetry/<strategist>/<gameID>-player-<playerID>.db',
    '  outDir       New or empty folder to write the files into',
    '  commit       Commit ID to copy (default: the current head)',
  ].join('\n'));
}

/** Parse a whole-number argument, or throw naming it. */
function parseNumber(value: string, name: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number, got "${value}"`);
  return Number(value);
}

/**
 * Run the `materialize` command: check the database holds a store before creating the output
 * folder, and write the chosen version there.
 */
function runMaterialize(args: string[]): void {
  if (args.length < 2 || args.length > 3) {
    printUsage();
    throw new Error('materialize takes <telemetryDb> <outDir> [commit]');
  }
  const [dbArg, outDir, commitArg] = args;
  const dbPath = path.resolve(dbArg);
  if (!WorkspaceStore.hasStore(dbPath)) throw new Error(`No workspace store in ${dbPath}`);
  const commit = commitArg === undefined ? undefined : parseNumber(commitArg, 'commit');
  const id = materialize(dbPath, diskSink(outDir), commit);
  logger.info(`Materialized commit ${id} of ${dbPath} into ${path.resolve(outDir)}`);
}

/** Main entry point. Runs the command, then shuts down through processManager. */
async function main(): Promise<void> {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command !== 'materialize') {
      printUsage();
      throw new Error(command ? `Unknown command "${command}"` : 'Missing command');
    }
    runMaterialize(args);
  } catch (error) {
    logger.error(`Workspace command failed: ${errorMessage(error)}`);
    process.exit(1);
  } finally {
    await processManager.shutdown('main-complete');
  }
}

main();
