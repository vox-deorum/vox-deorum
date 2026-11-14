/**
 * Dispatches the Release Version workflow with a drafted update log as the release message.
 */

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bumpTypes = ['patch', 'minor', 'major', 'none'];
const defaultNotesPath = '.tmp/release-notes.md';
const usage = 'Usage: npm run release -- <patch|minor|major|none> [--dry-run] [--notes <path>] [--yes]';

/** Reads the bump type and flags from the command line. */
function readOptions() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      notes: { type: 'string', default: defaultNotesPath },
      yes: { type: 'boolean', default: false },
    },
  });
  if (positionals.length !== 1 || !bumpTypes.includes(positionals[0])) {
    throw new Error(usage);
  }
  return {
    bumpType: positionals[0],
    dryRun: values['dry-run'],
    notesPath: resolve(repositoryRoot, values.notes),
    yes: values.yes,
  };
}

/** Runs a command at the repository root and returns its trimmed stdout, failing on a nonzero exit. */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr.trim();
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout.trim();
}

/** Reads the drafted notes and fails when the file is missing or empty. */
async function readNotes(notesPath) {
  let notes;
  try {
    notes = await readFile(notesPath, 'utf8');
  } catch {
    throw new Error(`No release notes at ${notesPath}. Draft them there first, or pass --notes <path>.`);
  }
  if (!notes.trim()) throw new Error(`Release notes at ${notesPath} are empty.`);
  return notes.trim();
}

/** Computes the version the workflow will produce from version.json and the bump type. */
async function nextVersion(bumpType) {
  let { major, minor, revision } = JSON.parse(await readFile(resolve(repositoryRoot, 'version.json'), 'utf8'));
  if (bumpType === 'major') [major, minor, revision] = [major + 1, 0, 0];
  if (bumpType === 'minor') [minor, revision] = [minor + 1, 0];
  if (bumpType === 'patch') revision += 1;
  return `v${major}.${minor}.${revision}`;
}

/** Makes sure the workflow, which builds from origin/main, will see exactly the local main. */
function checkGitState() {
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') throw new Error(`Switch to main first (currently on ${branch}).`);

  run('git', ['fetch', 'origin', 'main']);
  if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', 'origin/main'])) {
    throw new Error('Local main and origin/main differ. Push or pull first, since the workflow builds from origin/main.');
  }

  const changes = run('git', ['status', '--porcelain']);
  if (changes) {
    process.stderr.write(`Warning: these uncommitted changes will not ship:\n${changes}\n\n`);
  }
}

/** Asks for confirmation on the terminal and returns whether the answer was yes. */
async function confirm(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await prompt.question(question)).trim());
  } finally {
    prompt.close();
  }
}

/** Shows the release summary, confirms, and dispatches the workflow. */
async function main() {
  const { bumpType, dryRun, notesPath, yes } = readOptions();
  const notes = await readNotes(notesPath);
  const version = await nextVersion(bumpType);
  checkGitState();

  process.stdout.write(
    `Version: ${version}${dryRun ? ' (dry run)' : ''}\n` +
    `Notes: ${relative(repositoryRoot, notesPath)}\n\n${notes}\n\n`,
  );
  if (!yes && !(await confirm(dryRun ? 'Start dry run? [y/N] ' : `Publish ${version}? [y/N] `))) {
    process.stdout.write('Cancelled.\n');
    return;
  }

  const output = run('gh', [
    'workflow', 'run', 'release.yml', '--ref', 'main',
    '-f', `version_type=${bumpType}`,
    '-f', `dry_run=${dryRun}`,
    '-F', `release_notes=@${notesPath}`,
  ]);
  process.stdout.write(`${output || 'Workflow dispatched.'}\nFollow it with: gh run watch\n`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Could not start the release: ${message}\n`);
  process.exitCode = 1;
}
