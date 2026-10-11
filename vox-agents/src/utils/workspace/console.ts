/**
 * @module utils/workspace/console
 *
 * CLI entry point for seat workspace stores.
 *
 * Usage:
 *   npm run workspace -- materialize <gameID> <playerID> <outDir> [commit]
 *
 * `materialize` copies one version of a seat store, head by default, out as ordinary files. The
 * output folder must be new or empty. The store is only read.
 */

import fs from 'node:fs';
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
    'Usage: npm run workspace -- materialize <gameID> <playerID> <outDir> [commit]',
    '',
    '  gameID     Game the seat belongs to',
    '  playerID   Player ID of the seat',
    '  outDir     New or empty folder to write the files into',
    '  commit     Commit ID to copy (default: the current head)',
  ].join('\n'));
}

/** Parse a whole-number argument, or throw naming it. */
function parseNumber(value: string, name: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number, got "${value}"`);
  return Number(value);
}

/**
 * Run the `materialize` command: resolve the seat store, check it exists before creating the output
 * folder, and write the chosen version there.
 */
function runMaterialize(args: string[]): void {
  if (args.length < 3 || args.length > 4) {
    printUsage();
    throw new Error('materialize takes <gameID> <playerID> <outDir> [commit]');
  }
  const [gameID, player, outDir, commitArg] = args;
  const dbPath = WorkspaceStore.pathFor(gameID, parseNumber(player, 'playerID'));
  if (!fs.existsSync(dbPath)) throw new Error(`No workspace store for game ${gameID} player ${player} at ${dbPath}`);
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
