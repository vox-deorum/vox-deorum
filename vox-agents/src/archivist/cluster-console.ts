/**
 * @module archivist/cluster-console
 *
 * CLI for clustering saved story pitches and writing the Markdown report.
 * Reads every model's pitches from a finished episode database without starting
 * the archivist, resolving models, or writing to the source database.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../utils/logger.js';
import {
  clusterStoryPitches,
  defaultClusteringThreshold,
  readStoryPitches,
  renderStoryClusters,
} from './pipeline/story-clustering.js';

const logger = createLogger('Archivist:Cluster');

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const defaultClustersPath = path.join(repositoryRoot, '.tmp', 'newspaper-mining', 'clusters.md');

const usage = `Usage: npm run archivist:cluster -- -i <episodes.duckdb> [-o <clusters.md>] [--threshold <0-1>]

Reads every saved story pitch from an episode database and writes a Markdown
report grouped by embedding similarity. The default output is
.tmp/newspaper-mining/clusters.md at the repository root.

Options:
  -i, --input      Episode database containing story_pitches (required)
  -o, --output     Report path (default: .tmp/newspaper-mining/clusters.md)
      --threshold  Cosine similarity needed to join a cluster (default: 0.8)
  -h, --help       Show this message`;

/** Parse the threshold flag, which must be a finite number from 0 through 1. */
function parseThreshold(value: string | undefined): number {
  if (value === undefined) return defaultClusteringThreshold;
  const trimmed = value.trim();
  const threshold = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('--threshold must be a number from 0 to 1');
  }
  return threshold;
}

/**
 * Resolve a path through symlinks and directory aliases, including a leaf that
 * does not exist yet, by resolving the nearest existing ancestor.
 */
async function canonicalPath(target: string): Promise<string> {
  const absolute = path.resolve(target);
  try {
    return await realpath(absolute);
  } catch {
    const parent = path.dirname(absolute);
    if (parent === absolute) return absolute;
    return path.join(await canonicalPath(parent), path.basename(absolute));
  }
}

/** Compare two canonical paths using the platform's case rules. */
function samePath(left: string, right: string): boolean {
  if (process.platform !== 'win32') return left === right;
  return left.toLowerCase() === right.toLowerCase();
}

/** Refuse an output path that resolves to the input database or its WAL. */
async function assertOutputDoesNotTouchInput(inputPath: string, outputPath: string): Promise<void> {
  const canonicalInput = await canonicalPath(inputPath);
  const canonicalOutput = await canonicalPath(outputPath);
  if (samePath(canonicalInput, canonicalOutput)) {
    throw new Error('--output must not be the input database');
  }
  if (samePath(`${canonicalInput}.wal`, canonicalOutput)) {
    throw new Error('--output must not be the input database WAL');
  }
}

/** Write the report through a temporary file in the destination directory, then rename it. */
async function writeFileAtomically(outputPath: string, contents: string): Promise<void> {
  const directory = path.dirname(outputPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, contents, 'utf8');
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

/** Read the database, render the report, check the paths, then write the file. */
async function main(): Promise<void> {
  let values: {
    input?: string;
    output?: string;
    threshold?: string;
    help?: boolean;
  } = {};
  try {
    ({ values } = parseArgs({
      options: {
        input: { type: 'string', short: 'i' },
        output: { type: 'string', short: 'o' },
        threshold: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    logger.error('Invalid arguments', { error, usage });
    process.exitCode = 1;
    return;
  }

  if (values.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (!values.input) {
    logger.error('Missing required --input', { usage });
    process.exitCode = 1;
    return;
  }

  const inputPath = path.resolve(values.input);
  const outputPath = path.resolve(values.output ?? defaultClustersPath);
  try {
    const threshold = parseThreshold(values.threshold);
    const rows = await readStoryPitches(inputPath);
    const clustering = clusterStoryPitches(rows, threshold);
    const report = renderStoryClusters(clustering);
    await assertOutputDoesNotTouchInput(inputPath, outputPath);
    await writeFileAtomically(outputPath, report);
    logger.info('Wrote story pitch clusters', {
      input: inputPath,
      output: outputPath,
      rows: clustering.rowsRead,
      clustered: clustering.clustered,
      skipped: clustering.skipped,
      clusters: clustering.clusters.length,
      threshold,
    });
  } catch (error) {
    logger.error('Story pitch clustering failed', { error, input: inputPath, output: outputPath });
    process.exitCode = 1;
  }
}

main().catch(error => {
  logger.error('Story pitch clustering failed', { error });
  process.exitCode = 1;
});
