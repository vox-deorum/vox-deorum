/** Exports the current DLL delta from its shared upstream ancestor for review. */
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Runs Git without refreshing the index or invoking external diff drivers. */
function git(repo, args, accepted = [0]) {
  const result = spawnSync('git', ['--no-optional-locks', '-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' },
  });
  if (result.error) throw result.error;
  if (!accepted.includes(result.status)) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Escapes a file name for a Markdown table cell. */
function tableText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('|', '&#124;').replaceAll('`', '&#96;').replaceAll('\n', '&#10;');
}

/** Resolves a commit before using it in a diff or ancestry query. */
function commit(repo, ref) {
  return git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
}

/** Writes an inventory and patches without changing the source repository. */
async function main() {
  const { values } = parseArgs({ options: {
    repo: { type: 'string' },
    upstream: { type: 'string', default: 'upstream/master' },
    base: { type: 'string' },
    output: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    process.stdout.write(`Usage: npm run vp-diff -- [--output <new-directory>] [--base <commit>]
  --repo <path>      DLL checkout (default: civ5-dll)
  --upstream <ref>   Local upstream ref (default: upstream/master)
  --base <commit>    Explicit ancestor, overriding automatic merge-base selection
  --output <path>    New output directory (default: temp/upstream-review/review-*)

Includes committed, staged, unstaged, and non-ignored untracked files.
Renames are exported as deletion and addition. Ignored files are excluded.
Uses local history only. Fetch upstream beforehand if needed.
`);
    return;
  }

  const repo = await realpath(resolve(values.repo ?? join(repositoryRoot, 'civ5-dll')));
  const top = await realpath(git(repo, ['rev-parse', '--show-toplevel']).trim());
  if (top !== repo) throw new Error('The DLL path must be the root of an initialized Git checkout.');
  if (git(repo, ['ls-files', '--unmerged', '-z'])) {
    throw new Error('Resolve the DLL merge conflicts before exporting.');
  }
  const head = commit(repo, 'HEAD');
  const upstream = values.base ? null : commit(repo, values.upstream);
  const bases = values.base ? [commit(repo, values.base)]
    : git(repo, ['merge-base', '--all', head, upstream]).trim().split('\n');
  if (bases.length !== 1) throw new Error('Multiple shared ancestors found. Select one with --base <commit>.');
  const [base] = bases;
  git(repo, ['merge-base', '--is-ancestor', base, head]);

  const diffOptions = ['--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--no-relative', '--ignore-submodules=none'];
  const fields = git(repo, ['diff', ...diffOptions, '--name-status', '-z', base, '--']).split('\0');
  const files = [];
  for (let i = 0; i < fields.length - 1; i += 2) {
    files.push({ status: fields[i], path: fields[i + 1], untracked: false });
  }
  const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  for (const path of untracked) files.push({ status: 'A', path, untracked: true });
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const status = git(repo, ['status', '--porcelain=v1', '--untracked-files=all']);

  let output;
  if (values.output) {
    output = resolve(values.output);
    const insideRepo = relative(repo, output);
    if (!insideRepo || (!isAbsolute(insideRepo) && insideRepo !== '..' && !insideRepo.startsWith(`..${sep}`))) {
      throw new Error('Choose an output directory outside the DLL checkout.');
    }
    await mkdir(dirname(output), { recursive: true });
    await mkdir(output);
  } else {
    const parent = join(repositoryRoot, 'temp', 'upstream-review');
    await mkdir(parent, { recursive: true });
    output = await mkdtemp(join(parent, 'review-'));
  }
  await mkdir(join(output, 'patches'));
  const patches = [];
  for (const [index, file] of files.entries()) {
    const options = [...diffOptions, '--binary', '--full-index', '--src-prefix=a/', '--dst-prefix=b/'];
    const patch = file.untracked
      ? git(repo, ['diff', '--no-index', ...options, '--', '/dev/null', file.path], [0, 1])
      : git(repo, ['diff', ...options, base, '--', file.path]);
    file.patch = `patches/${String(index + 1).padStart(4, '0')}.patch`;
    await writeFile(join(output, file.patch), patch);
    patches.push(patch);
  }

  const manifest = { generatedAt: new Date().toISOString(), repo, head, base,
    upstreamRef: values.base ? null : values.upstream, upstream, files };
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(output, 'changes.patch'), patches.join(''));
  await writeFile(join(output, 'status.txt'), status);
  const summary = git(repo, ['show', '-s', '--format=%h %cs %s', base]).trim();
  await writeFile(join(output, 'index.md'), `# DLL changes for upstream review

Base: ${tableText(summary)} (\`${base}\`).
DLL HEAD: \`${head}\`.
Generated: ${manifest.generatedAt}.

This is the net delta from the shared upstream ancestor to the current working tree,
including staged, unstaged, and non-ignored untracked files. Renames appear as
deletions and additions. The export includes VD infrastructure so every file can
be reviewed; group selected hunks into focused PRs separately.

${files.length} file entries. [Combined patch](changes.patch), [manifest](manifest.json), [working tree status](status.txt).

| Status | File | Patch |
| --- | --- | --- |
${files.map(file => `| ${file.untracked ? 'Untracked' : file.status} | ${tableText(file.path)} | [Review](${file.patch}) |`).join('\n')}

Status: A = added, M = modified, D = deleted, T = type changed.
Binary changes are included as Git binary patches. Nested submodule changes show
gitlink differences only; their contents are not recursively exported.
`);
  process.stdout.write(`Exported ${files.length} file entries from ${base.slice(0, 12)}.\nOpen ${join(output, 'index.md')}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`vp-diff: ${error.message}\n`);
  process.exitCode = 1;
}
