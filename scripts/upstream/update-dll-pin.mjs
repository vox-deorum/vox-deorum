/** Pins a published DLL build to the current civ5-dll checkout. */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const releaseRepo = 'CIVITAS-John/vox-populi';

/** Runs a read-only Git or GitHub CLI query without a shell. */
function query(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw new Error(`${command} is required: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

/** Reads repository-controlled KEY=value records. */
function readRecords(path) {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/)
    .filter(line => line.includes('=') && !line.startsWith(';'))
    .map(line => line.split('=').map(value => value.trim())));
}

/** Finds and verifies a published build before changing the selected pin. */
export function updateDllPin(root, selectedLine, dryRun = false) {
  const records = readRecords(join(root, 'scripts', 'vp-lines.txt'));
  const line = selectedLine ?? records.DEFAULT_LINE;
  if (!/^\d+\.\d+$/.test(line) || !records.LINES?.split(/\s+/).includes(line)) {
    throw new Error(`Unsupported VP line: ${line}`);
  }
  const pinPath = join(root, 'scripts', `dll-release-info-${line}.txt`);
  const previous = readFileSync(pinPath, 'utf8');
  const source = join(root, 'civ5-dll');
  const top = query('git', ['-C', source, 'rev-parse', '--show-toplevel']);
  if (realpathSync(top) !== realpathSync(source)) {
    throw new Error('Initialize the civ5-dll submodule before updating its pin.');
  }
  const commit = query('git', ['-C', source, 'rev-parse', '--verify', 'HEAD^{commit}']);
  const tagPattern = new RegExp(`^build-${line.replace('.', '\\.')}\\.\\d+-\\d{8}-\\d{6}-${commit.slice(0, 7)}$`);
  const requiredAssets = ['CvGameCore_Expansion2-Release.dll', 'CvGameCore_Expansion2-Debug.dll', 'version.txt'];
  let release;
  for (let page = 1; !release; page++) {
    const releases = JSON.parse(query('gh', ['api', `repos/${releaseRepo}/releases?per_page=100&page=${page}`]));
    release = releases.find(candidate => !candidate.draft && !candidate.prerelease
      && tagPattern.test(candidate.tag_name)
      && requiredAssets.every(name => candidate.assets.some(asset => asset.name === name && asset.size > 0)));
    if (releases.length < 100) break;
  }
  if (!release) {
    throw new Error(`No complete published VP ${line} DLL release for ${commit}. Push that commit to vox-deorum-${line} and wait for its DLL build, then retry. Pin unchanged.`);
  }
  // The publishing workflow records the build source in its body; older tags point to master.
  const buildCommit = release.body?.match(/^\*\*Commit:\*\*\s*([a-f0-9]{40})\s*$/m)?.[1];
  const buildBranch = release.body?.match(/^\*\*Branch:\*\*\s*(\S+)\s*$/m)?.[1];
  if (buildCommit !== commit || buildBranch !== `vox-deorum-${line}`) {
    throw new Error(`Release ${release.tag_name} does not record build commit ${commit} on vox-deorum-${line}. Pin unchanged.`);
  }
  const content = `RELEASE_TAG=${release.tag_name}\nCOMMIT=${commit}\n`;
  const changed = previous.replaceAll('\r\n', '\n') !== content;
  if (changed && !dryRun) writeFileSync(pinPath, content);
  return { line, commit, tag: release.tag_name, pinPath, changed };
}

/** Parses the command and reports the pin that installation will consume. */
function main() {
  const { values } = parseArgs({ options: {
    line: { type: 'string' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    process.stdout.write(`Usage: npm run update:dll-pin -- [--line X.Y] [--dry-run]

Selects the published DLL release matching civ5-dll HEAD and updates its pin.
Defaults to DEFAULT_LINE in scripts/vp-lines.txt. Requires Git and GitHub CLI.
--dry-run verifies the release and prints the selection without writing it.
Does not build, download, change the checkout, stage, or commit files.
After review, commit the pin with the default line's civ5-dll update.
Run scripts/install.cmd to install the newly pinned DLL locally.
`);
    return;
  }
  const result = updateDllPin(repositoryRoot, values.line, values['dry-run']);
  const action = !result.changed ? 'Already current' : values['dry-run'] ? 'Would update' : 'Updated';
  process.stdout.write(`${action}: ${result.pinPath}\nVP ${result.line}: ${result.tag}\nCommit: ${result.commit}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`update:dll: ${error.message}\n`);
    process.exitCode = 1;
  }
}
