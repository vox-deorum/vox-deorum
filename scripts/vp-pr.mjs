/**
 * Prepares a Vox Populi upstream pull request from Vox Deorum changes.
 *
 * The workflow lives entirely inside the civ5-dll submodule. Every git call
 * uses `git -C civ5-dll` and no outer-repository command is ever run, so the
 * outer index stays untouched. The one side effect is the gitlink: checking
 * out a PR branch changes which commit the submodule points at, which the
 * outer repository reports as a modified gitlink. That gitlink change must
 * never be committed; the restore command returns it to normal.
 *
 * The script never pushes and never opens a pull request. Publishing a branch
 * is the contributor's job, so finish and backport print the exact commands.
 */

import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const submoduleDir = join(repositoryRoot, 'civ5-dll');
const linesFilePath = join(repositoryRoot, 'scripts', 'vp-lines.txt');

const upstreamRepo = 'LoneGazebo/Community-Patch-DLL';
const forkOwner = 'CIVITAS-John';
const branchPrefix = 'pr/';
const upstreamMaster = 'upstream/master';
const markerPatterns = ['Vox Deorum', 'MOD_IPC_CHANNEL', 'CvConnection', 'ArduinoJson'];
const valueFlags = new Set(['title', 'body-file', 'base', 'from', 'line']);

/** An expected failure with a message for the user; main prints it and exits 1. */
class UsageError extends Error {}

/** Prints one line of plain text to stdout. */
function out(...parts) {
  process.stdout.write(`${parts.join(' ')}\n`);
}

/** Runs git inside the submodule and returns the raw spawn result. */
function runGit(args, { allowFail = false } = {}) {
  const result = spawnSync('git', ['-C', submoduleDir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    throw new Error(`Could not run git: ${result.error.message}`);
  }
  if (!allowFail && result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result;
}

/** Returns the submodule's real git directory (the outer .git/modules entry). */
function gitDir() {
  return runGit(['rev-parse', '--absolute-git-dir']).stdout.trim();
}

/** Returns the path of the workflow state file inside the git directory. */
function stateFilePath() {
  return join(gitDir(), 'vp-pr-state.json');
}

/** Returns the current branch name, or an empty string when detached. */
function currentBranch() {
  return runGit(['branch', '--show-current']).stdout.trim();
}

/** Returns true when a cherry-pick is in progress in the submodule. */
function isMidCherryPick() {
  return existsSync(join(gitDir(), 'CHERRY_PICK_HEAD'));
}

/** Returns true when the submodule worktree has any staged, unstaged, or untracked change. */
function isWorktreeDirty() {
  return runGit(['status', '--porcelain']).stdout.trim() !== '';
}

/** Returns the number of commits reachable from head but not from base. */
function countAhead(base, head) {
  return Number(runGit(['rev-list', '--count', `${base}..${head}`]).stdout.trim());
}

/** Returns the resolved full SHA for a commit-ish, or null when unresolvable. */
function resolveCommit(rev) {
  const result = runGit(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFail: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Returns the files currently in merge conflict. */
function conflictedFiles() {
  const result = runGit(['diff', '--name-only', '-z', '--diff-filter=U'], { allowFail: true });
  return result.stdout.split('\0').filter(Boolean);
}

/** Reads scripts/vp-lines.txt; the file and both keys are required. */
async function readLines() {
  let content;
  try {
    content = await readFile(linesFilePath, 'utf8');
  } catch {
    throw new UsageError(`Could not read ${linesFilePath}.`);
  }
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) values[match[1]] = match[2].split(/[\s,]+/).filter(Boolean);
  }
  const defaultLine = values.DEFAULT_LINE?.[0];
  const lines = values.LINES ?? [];
  if (!defaultLine || lines.length === 0) {
    throw new UsageError('scripts/vp-lines.txt must define DEFAULT_LINE and LINES.');
  }
  return { defaultLine, lines };
}

/** Reads the workflow state file, or null when no workflow is in progress. */
async function readState() {
  try {
    return JSON.parse(await readFile(stateFilePath(), 'utf8'));
  } catch {
    return null;
  }
}

/** Writes the workflow state file. */
async function writeState(state) {
  await writeFile(stateFilePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** Removes the workflow state file, ignoring a missing file. */
async function clearState() {
  try {
    await unlink(stateFilePath());
  } catch {
    // Nothing to clear.
  }
}

/** Requires both git remotes and names the exact fix when one is missing. */
function ensureRemotes() {
  const configured = runGit(['remote']).stdout.split(/\r?\n/).filter(Boolean);
  const missing = [];
  if (!configured.includes('origin')) missing.push(['origin', `https://github.com/${forkOwner}/vox-populi.git`]);
  if (!configured.includes('upstream')) missing.push(['upstream', `https://github.com/${upstreamRepo}.git`]);
  if (missing.length === 0) return;
  const fixes = missing.map(([name, url]) => `  git -C civ5-dll remote add ${name} ${url}`);
  throw new UsageError(`Required git remotes are missing in civ5-dll. Fix with:\n${fixes.join('\n')}`);
}

/**
 * Shared preflight for every command except status: remotes exist, no
 * cherry-pick is in progress, and the worktree is clean unless the caller
 * will stash it. A cherry-pick in progress is reported with resume
 * instructions because uncommitted gamecore edits are usually in-progress
 * work that must not be swept away.
 */
function preflight({ dirtyAllowed = false } = {}) {
  ensureRemotes();
  if (isMidCherryPick()) {
    throw new UsageError(`A cherry-pick is in progress.\n${conflictAdvice()}`);
  }
  if (!dirtyAllowed && isWorktreeDirty()) {
    throw new UsageError('The civ5-dll submodule has uncommitted changes. Commit, stash, or clean them first, or start with `new <slug> --carry` to move them onto the PR branch or `new <slug> --stash` to set them aside until `restore` (`status` still works on a dirty submodule).');
  }
}

/** Stashes every local change, tracked and untracked, and returns the stash commit SHA. */
function stashChanges(label) {
  runGit(['stash', 'push', '--include-untracked', '-m', `vp-pr: ${label}`]);
  return runGit(['rev-parse', 'refs/stash']).stdout.trim();
}

/** Reapplies a stash by commit SHA and drops it; returns false when it did not apply cleanly. */
function applyStash(sha) {
  let result = runGit(['stash', 'apply', '--index', sha], { allowFail: true });
  if (result.status !== 0) result = runGit(['stash', 'apply', sha], { allowFail: true });
  if (result.status !== 0) return false;
  const entries = runGit(['stash', 'list', '--format=%gd %H']).stdout.split(/\r?\n/).filter(Boolean);
  const entry = entries.find(line => line.endsWith(` ${sha}`));
  if (entry) runGit(['stash', 'drop', entry.split(' ')[0]]);
  return true;
}

/** Explains how to recover a stash that did not reapply cleanly. */
function stashAdvice(sha) {
  return `The stashed changes (${sha.slice(0, 12)}) did not reapply cleanly and are kept in the stash list. Resolve the conflicted files, then find the entry with \`git -C civ5-dll stash list\` and drop it.`;
}

/** Describes the current cherry-pick stop and how to resume it. */
function conflictAdvice() {
  const files = conflictedFiles();
  if (files.length === 0) {
    return 'The cherry-pick stopped without conflicts, which means the change already exists on this branch. Run `git -C civ5-dll cherry-pick --skip` to drop it, or `git -C civ5-dll cherry-pick --abort` to stop.';
  }
  const list = files.map(file => `    ${file}`).join('\n');
  return `  Conflicted files:\n${list}\nResolve them, then run \`git -C civ5-dll cherry-pick --continue\`, or abort with \`git -C civ5-dll cherry-pick --abort\`. Never auto-resolve here.`;
}

/** Returns the files the branch changes relative to upstream/master, and the subset still present on HEAD. */
function changedFiles() {
  const all = runGit(['diff', '--name-only', '-z', `${upstreamMaster}...HEAD`]).stdout.split('\0').filter(Boolean);
  const present = runGit(['diff', '--name-only', '-z', '--diff-filter=d', `${upstreamMaster}...HEAD`]).stdout.split('\0').filter(Boolean);
  return { all, present };
}

/**
 * Finds Vox Deorum residue in the branch: marker strings inside changed files
 * on HEAD, plus changed file names that themselves name Vox Deorum-only code.
 * The base is upstream, which carries no markers, so any hit is the branch's.
 */
function findMarkerHits() {
  const { all, present } = changedFiles();
  const hits = [];
  for (const file of all) {
    for (const pattern of markerPatterns) {
      if (file.includes(pattern)) hits.push({ pattern, file, line: 0 });
    }
  }
  if (present.length === 0) return hits;
  const grepArgs = ['grep', '-n', '-I', '-F', '-z', '--no-color'];
  for (const pattern of markerPatterns) grepArgs.push('-e', pattern);
  grepArgs.push('HEAD', '--', ...present.map(file => `:(literal)${file}`));
  const result = runGit(grepArgs, { allowFail: true });
  if (result.status > 1) {
    throw new Error(`git grep failed:\n${(result.stderr || '').trim()}`);
  }
  for (const rawLine of result.stdout.split('\n')) {
    const [prefixedFile, lineNumber, ...content] = rawLine.split('\0');
    if (content.length === 0) continue;
    const file = prefixedFile.replace(/^HEAD:/, '');
    const text = content.join('\0');
    for (const pattern of markerPatterns) {
      if (text.includes(pattern)) hits.push({ pattern, file, line: Number(lineNumber) });
    }
  }
  return hits;
}

/** Prints the marker census for the current branch and returns the hits. */
function printMarkerCensus() {
  const hits = findMarkerHits();
  const counts = Object.fromEntries(markerPatterns.map(pattern => [pattern, 0]));
  for (const hit of hits) counts[hit.pattern] += 1;
  out('Marker census of the branch against upstream/master (must reach zero before finish):');
  for (const [pattern, count] of Object.entries(counts)) out(`  ${pattern}: ${count}`);
  return hits;
}

/** Refuses to finish when markers remain in the branch, unless allowed. */
function guardMarkers(allowMarkers) {
  const hits = findMarkerHits();
  if (allowMarkers || hits.length === 0) return;
  const lines = hits.slice(0, 50).map(hit => `  ${hit.file}:${hit.line || 'name'}  (${hit.pattern})`);
  if (hits.length > lines.length) lines.push(`  ...and ${hits.length - lines.length} more.`);
  throw new UsageError(`The PR branch still contains Vox Deorum residue. Clean it first:\n${lines.join('\n')}\nIf a hit is genuinely required, rerun with --allow-markers.`);
}

/** Prints the reminder that the outer gitlink must not be committed. */
function warnOuterGitlink() {
  out('The outer repository now shows the civ5-dll gitlink as changed. Do not stage or commit it; `restore` returns it to normal when the workflow ends.');
}

/** Prints the help text listing every subcommand and its flags. */
function printHelp() {
  out('Usage: npm run vp-pr -- <command> [...options]');
  out('');
  out('Commands:');
  out('  new <slug> [--base <ref>] [--carry | --stash]');
  out('                                       Start a PR branch off upstream/master (or --base). --carry moves uncommitted');
  out('                                       changes onto it; --stash sets them aside until restore.');
  out('  pick <commit>... [--from <branch>]   Cherry-pick line commits onto the current pr/* branch.');
  out('  finish <slug> --title "..." [--body-file <path>] [--allow-markers]');
  out('                                       Marker-check and squash to one commit, then print the push command.');
  out('  backport <commit>... [--line <X.Y>]  Cherry-pick a squashed PR commit onto line branches (default line when omitted).');
  out('  status                               Read-only workflow dashboard.');
  out('  restore                              Return the submodule to the checkout recorded by `new`.');
  out('');
  out('The script never pushes or opens pull requests; it prints the commands for the contributor.');
}

/** Parses subcommand arguments into positionals and a flags map of value lists. */
function parseArgs(args) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eqIndex = arg.indexOf('=');
    const name = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex);
    let value = eqIndex === -1 ? undefined : arg.slice(eqIndex + 1);
    if (valueFlags.has(name) && value === undefined) {
      value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`Flag --${name} requires a value.`);
      }
      i += 1;
    }
    (flags[name] ??= []).push(value ?? '');
  }
  return { flags, positionals };
}

/** Validates a slug against the allowed character set. */
function validateSlug(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new UsageError('Slugs may contain only lowercase letters, digits, and hyphens.');
  }
}

/** Resolves every commit argument to a full SHA, fetching origin once when needed. */
function resolveCommits(commits) {
  if (commits.some(commit => resolveCommit(commit) === null)) {
    out('Some commits are not present locally; fetching origin and retrying...');
    runGit(['fetch', 'origin']);
  }
  return commits.map(commit => {
    const sha = resolveCommit(commit);
    if (sha === null) {
      throw new UsageError(`Commit ${commit} could not be resolved locally or on origin. Check the SHA and the branch it lives on.`);
    }
    return sha;
  });
}

/** Runs a cherry-pick and turns a stop into a usage error with resume advice. */
function cherryPick(args) {
  const result = runGit(['cherry-pick', ...args], { allowFail: true });
  if (result.status === 0) return;
  if (isMidCherryPick()) {
    throw new UsageError(`The cherry-pick stopped.\n${conflictAdvice()}`);
  }
  throw new UsageError((result.stderr || result.stdout || 'cherry-pick failed').trim());
}

/**
 * Runs the `new` subcommand: fresh PR branch off upstream/master. With
 * --carry, uncommitted changes travel onto the PR branch as the starting
 * point; with --stash, they are set aside and come back on restore.
 */
async function commandNew(args) {
  const { flags, positionals } = parseArgs(args);
  const carry = flags.carry !== undefined;
  const stash = flags.stash !== undefined;
  if (positionals.length !== 1 || (carry && stash)) {
    throw new UsageError('Usage: npm run vp-pr -- new <slug> [--base <ref>] [--carry | --stash]');
  }
  const slug = positionals[0];
  validateSlug(slug);
  const base = flags.base?.[0] || upstreamMaster;
  preflight({ dirtyAllowed: carry || stash });

  const branchName = currentBranch();
  if (branchName.startsWith(branchPrefix) || (await readState()) !== null) {
    throw new UsageError('A PR workflow is already in progress. Run `npm run vp-pr -- restore` before starting another one.');
  }

  out('Fetching upstream and origin...');
  runGit(['fetch', 'upstream', '--tags', '--prune']);
  runGit(['fetch', 'origin']);

  const prBranch = `${branchPrefix}${slug}`;
  const existsLocally = resolveCommit(`refs/heads/${prBranch}`) !== null;
  const existsOnOrigin = resolveCommit(`refs/remotes/origin/${prBranch}`) !== null;
  if (existsLocally || existsOnOrigin) {
    throw new UsageError(`Branch ${prBranch} already exists locally or on origin. Deleting branches is a human decision; remove it first if you truly want to recreate it.`);
  }
  if (resolveCommit(base) === null) {
    throw new UsageError(`Base ${base} does not exist after the fetch.`);
  }

  const stashSha = (carry || stash) && isWorktreeDirty() ? stashChanges(slug) : null;
  if (stashSha) out(`Stashed the uncommitted changes as ${stashSha.slice(0, 12)}.`);
  await writeState({ branch: branchName, sha: resolveCommit('HEAD'), stash: stash ? stashSha : null });
  runGit(['checkout', '-b', prBranch, base]);
  out(`Created ${prBranch} at ${resolveCommit('HEAD')} (base ${base}).`);
  if (carry && stashSha) {
    if (applyStash(stashSha)) {
      out('Reapplied the uncommitted changes onto the PR branch; review and commit them there.');
    } else {
      out(stashAdvice(stashSha));
    }
  }
  out('');
  out('Next steps:');
  out('  1. npm run vp-pr -- pick <commit>... --from vox-deorum-<line>   (or author or commit the change directly)');
  out('  2. npm run vp-pr -- status                                       (check the marker census while cleaning)');
  out('  3. npm run vp-pr -- finish <slug> --title "..."                  (squash to one commit)');
  warnOuterGitlink();
}

/** Runs the `pick` subcommand: cherry-pick line commits onto the current pr/* branch. */
function commandPick(args) {
  const { flags, positionals } = parseArgs(args);
  if (positionals.length === 0) {
    throw new UsageError('Usage: npm run vp-pr -- pick <commit>... [--from <branch>]');
  }
  const branch = currentBranch();
  if (!branch.startsWith(branchPrefix)) {
    throw new UsageError(`pick must run on a ${branchPrefix} branch; currently on ${branch || '(detached HEAD)'}.`);
  }
  preflight();

  const from = flags.from?.[0];
  if (from && resolveCommit(from) === null) {
    throw new UsageError(`--from branch ${from} does not exist locally.`);
  }
  const shas = resolveCommits(positionals);
  if (from) {
    for (const sha of shas) {
      if (runGit(['merge-base', '--is-ancestor', sha, from], { allowFail: true }).status !== 0) {
        throw new UsageError(`Commit ${sha} is not part of ${from}.`);
      }
    }
  }

  out('Cherry-picking (no -x; history is squashed later)...');
  cherryPick(shas);
  out('Cherry-pick applied cleanly.');
  printMarkerCensus();
  warnOuterGitlink();
}

/** Runs the `finish` subcommand: marker guard, squash, and push instructions. */
async function commandFinish(args) {
  const { flags, positionals } = parseArgs(args);
  const title = flags.title?.[0];
  if (positionals.length !== 1 || !title) {
    throw new UsageError('Usage: npm run vp-pr -- finish <slug> --title "..." [--body-file <path>] [--allow-markers]');
  }
  const slug = positionals[0];
  const branch = `${branchPrefix}${slug}`;
  if (currentBranch() !== branch) {
    throw new UsageError(`finish must run on ${branch}; currently on ${currentBranch() || '(detached HEAD)'}.`);
  }
  preflight();

  const mergeBase = runGit(['merge-base', upstreamMaster, 'HEAD']).stdout.trim();
  const ahead = countAhead(mergeBase, 'HEAD');
  if (ahead < 1) {
    throw new UsageError('This branch has no commits beyond the upstream base. Nothing to finish.');
  }
  if (runGit(['diff', '--quiet', mergeBase, 'HEAD'], { allowFail: true }).status === 0) {
    throw new UsageError('This branch changes nothing relative to the upstream base. Nothing to finish.');
  }
  guardMarkers(flags['allow-markers'] !== undefined);

  const messageArgs = ['-m', title];
  const bodyFile = flags['body-file']?.[0];
  if (bodyFile) {
    let body;
    try {
      body = await readFile(resolve(repositoryRoot, bodyFile), 'utf8');
    } catch {
      throw new UsageError(`Could not read --body-file ${bodyFile}.`);
    }
    if (body.trim()) messageArgs.push('-m', body.trim());
  }

  const subject = runGit(['log', '-1', '--format=%s']).stdout.trim();
  if (ahead === 1 && subject === title && !bodyFile) {
    out('Already a single commit with this title; leaving it unchanged.');
  } else if (ahead === 1) {
    runGit(['commit', '--amend', ...messageArgs]);
    out('Rewrote the message of the single commit.');
  } else {
    runGit(['reset', '--soft', mergeBase]);
    runGit(['commit', ...messageArgs]);
    out(`Squashed ${ahead} commits into one.`);
  }

  out(`  ${runGit(['log', '--oneline', `${mergeBase}..HEAD`]).stdout.trim()}`);
  const stat = runGit(['diff', '--stat', `${mergeBase}..HEAD`]).stdout.trim();
  if (stat) out(stat);
  printMarkerCensus();
  out('');
  out("The branch is ready. Publishing it is the contributor's job:");
  out(`  git -C civ5-dll push -u origin ${branch}`);
  out(`  https://github.com/${upstreamRepo}/compare/master...${forkOwner}:${branch}?expand=1`);
  warnOuterGitlink();
}

/** Runs the `backport` subcommand: cherry-pick a squashed PR commit onto line branches. */
async function commandBackport(args) {
  const { flags, positionals } = parseArgs(args);
  if (positionals.length === 0) {
    throw new UsageError('Usage: npm run vp-pr -- backport <commit>... [--line <X.Y>]...');
  }
  preflight();

  const { defaultLine, lines: knownLines } = await readLines();
  const targets = [...new Set(flags.line ?? [defaultLine])];
  for (const line of targets) {
    if (!knownLines.includes(line)) {
      throw new UsageError(`Line ${line} is not in LINES (${knownLines.join(', ')} in scripts/vp-lines.txt).`);
    }
  }

  out('Fetching origin (line branches live on the fork)...');
  runGit(['fetch', 'origin']);
  const shas = resolveCommits(positionals);
  const modified = [];

  for (const line of targets) {
    const lineBranch = `vox-deorum-${line}`;
    const localSha = resolveCommit(`refs/heads/${lineBranch}`);
    const remoteSha = resolveCommit(`refs/remotes/origin/${lineBranch}`);
    if (remoteSha === null) {
      throw new UsageError(`origin has no ${lineBranch} branch. Publish the line branch first.`);
    }
    if (localSha === null) {
      runGit(['checkout', '-b', lineBranch, `refs/remotes/origin/${lineBranch}`]);
    } else {
      const isBehindOrEqual = runGit(['merge-base', '--is-ancestor', localSha, remoteSha], { allowFail: true }).status === 0;
      if (!isBehindOrEqual) {
        throw new UsageError(`Local ${lineBranch} (${localSha.slice(0, 12)}) is ahead of or diverged from origin (${remoteSha.slice(0, 12)}). Publish or reset it first; line branches are never rebased.`);
      }
      runGit(['checkout', lineBranch]);
      if (localSha !== remoteSha) {
        runGit(['merge', '--ff-only', `refs/remotes/origin/${lineBranch}`]);
        out(`Fast-forwarded ${lineBranch} to origin.`);
      }
    }
    out(`Backporting to ${lineBranch} with provenance trailers (-x)...`);
    try {
      cherryPick(['-x', ...shas]);
    } catch (error) {
      const remaining = targets.filter(target => target !== line && !modified.includes(target));
      const suffix = remaining.length > 0 ? `\nLines not yet processed: ${remaining.join(', ')}. Re-run backport with --line for each of them.` : '';
      throw new UsageError(`Backport to ${lineBranch} stopped. ${error.message}${suffix}`);
    }
    modified.push(line);
    out(`  ${runGit(['log', '--oneline', '-1']).stdout.trim()}`);
  }

  out('');
  out('Next: annotate the backported hunks with `// Vox Deorum: upstreamed <PR URL>` markers, so an upstream merge can find hunks that dissolve once upstream merges.');
  out("Publishing the line branches is the contributor's job:");
  for (const line of modified) out(`  git -C civ5-dll push origin vox-deorum-${line}`);
}

/** Runs the `status` subcommand: read-only workflow dashboard. */
async function commandStatus() {
  const branch = currentBranch();
  out(`Current branch: ${branch || '(detached HEAD)'}`);
  out(`Submodule worktree: ${isWorktreeDirty() ? 'dirty' : 'clean'}`);
  const midPick = isMidCherryPick();
  out(`Cherry-pick in progress: ${midPick ? 'yes' : 'no'}`);
  if (midPick) out(conflictAdvice());

  const upstreamSha = resolveCommit(upstreamMaster);
  if (upstreamSha === null) {
    out('Local upstream/master: missing; fetch with `git -C civ5-dll fetch upstream --tags --prune`.');
  } else {
    out(`Local upstream/master: ${upstreamSha}`);
    const remote = spawnSync('git', ['-C', submoduleDir, 'ls-remote', '--heads', 'upstream', 'refs/heads/master'], { encoding: 'utf8', timeout: 10_000 });
    if (remote.status === 0 && remote.stdout.trim()) {
      const remoteSha = remote.stdout.trim().split(/\s+/)[0];
      if (remoteSha === upstreamSha) {
        out('  Upstream is up to date with the remote.');
      } else {
        out(`  WARNING: upstream/master is stale (remote has ${remoteSha.slice(0, 12)}). Fetch with \`git -C civ5-dll fetch upstream --tags --prune\`.`);
      }
    } else {
      out('  Could not reach upstream to check freshness.');
    }
  }

  const prBranches = runGit(['for-each-ref', '--format=%(refname:short)', `refs/heads/${branchPrefix}*`]).stdout.split(/\r?\n/).filter(Boolean);
  if (prBranches.length === 0) {
    out(`No local ${branchPrefix} branches.`);
  } else {
    out(`Local ${branchPrefix} branches:`);
    for (const ref of prBranches) {
      const ahead = upstreamSha === null ? 0 : countAhead(upstreamMaster, ref);
      const subject = runGit(['log', '--oneline', '-1', ref]).stdout.trim();
      out(`  ${ref} (${ahead} commit${ahead === 1 ? '' : 's'} ahead of upstream/master) ${subject}${branch === ref ? '  <-- current' : ''}`);
    }
  }

  if (branch.startsWith(branchPrefix) && upstreamSha !== null) {
    out('');
    printMarkerCensus();
  }
  out(`State file: ${JSON.stringify(await readState())}`);
}

/** Runs the `restore` subcommand: return to the checkout recorded by `new`. */
async function commandRestore() {
  preflight();
  const state = await readState();
  if (state === null) {
    out('No workflow state recorded; nothing to restore.');
    return;
  }
  if (state.branch && resolveCommit(state.branch) === state.sha) {
    runGit(['checkout', state.branch]);
    out(`Restored to ${state.branch} (${state.sha.slice(0, 12)}).`);
  } else {
    runGit(['checkout', '--detach', state.sha]);
    out(`Restored to detached HEAD at ${state.sha.slice(0, 12)} (${state.branch || 'no recorded branch'} is at another commit).`);
  }
  if (state.stash) {
    out(applyStash(state.stash) ? 'Reapplied the changes that `new --stash` set aside.' : stashAdvice(state.stash));
  }
  await clearState();
  out('Check the outer `git status`: the civ5-dll gitlink should be back to normal.');
}

/** Dispatches the first argument to the matching subcommand. */
async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  switch (command) {
    case 'new':
      await commandNew(rest);
      break;
    case 'pick':
      commandPick(rest);
      break;
    case 'finish':
      await commandFinish(rest);
      break;
    case 'backport':
      await commandBackport(rest);
      break;
    case 'status':
      await commandStatus();
      break;
    case 'restore':
      await commandRestore();
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      throw new UsageError(`Unknown command ${command}. Run \`npm run vp-pr -- help\`.`);
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`vp-pr: ${message}\n`);
  process.exitCode = 1;
}
