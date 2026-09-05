/**
 * Updates the managed codex-openai-proxy pin and its operational references.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const targetPaths = {
  source: 'vox-agents/src/utils/models/providers/codex-proxy.ts',
  test: 'vox-agents/tests/mock/utils/providers/codex-proxy.test.ts',
  developerGuide: 'docs/developers/vox-agents/codex.md',
  operations: 'docs/developers/operations.md',
};
const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Returns the single capture produced by a version pattern. */
function captureVersion(content, pattern, path, captureIndex = 1) {
  const matches = [...content.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one version reference in ${path}, found ${matches.length}.`);
  }
  return matches[0][captureIndex];
}

/** Replaces one validated version reference without changing surrounding text. */
function replaceVersion(content, pattern, replacement, path) {
  captureVersion(content, pattern, path);
  return content.replace(pattern, replacement);
}

/** Expands an rc shorthand against the current release base and validates full versions. */
function normalizeTargetVersion(input, currentVersion) {
  if (/^rc\.\d+$/.test(input)) {
    if (!/-rc\.\d+$/.test(currentVersion)) {
      throw new Error(`Cannot apply ${input} shorthand to current version ${currentVersion}.`);
    }
    return currentVersion.replace(/rc\.\d+$/, input);
  }
  if (!exactVersionPattern.test(input)) {
    throw new Error('Pass a version such as rc.12 or 0.1.0-rc.12.');
  }
  return input;
}

/** Reads the exact package manifest and returns its bundled Codex CLI version. */
async function fetchBundledCodexVersion(proxyVersion) {
  const url = `https://registry.npmjs.org/codex-openai-proxy/${encodeURIComponent(proxyVersion)}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new Error(`Could not read codex-openai-proxy@${proxyVersion} from the npm registry.`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status} for codex-openai-proxy@${proxyVersion}.`);
  }

  const manifest = await response.json();
  if (manifest.version !== proxyVersion) {
    throw new Error(`npm registry resolved ${proxyVersion} to unexpected version ${String(manifest.version)}.`);
  }

  const codexVersion = manifest.dependencies?.['@openai/codex'];
  if (typeof codexVersion !== 'string' || !exactVersionPattern.test(codexVersion)) {
    throw new Error(`codex-openai-proxy@${proxyVersion} does not declare an exact @openai/codex dependency.`);
  }
  return codexVersion;
}

/** Updates every operational pin after all current references have been validated. */
async function main() {
  const input = process.argv[2];
  if (!input || process.argv.length > 3) {
    throw new Error('Usage: npm run update:codex-proxy -- <version|rc.number>');
  }

  const sourcePattern = /export const codexProxyVersion = '([^']+)';/;
  const testPattern = /`codex-openai-proxy@([^`]+)`, 'serve'/;
  const operationsPattern = /npx --yes codex-openai-proxy@(\S+) serve/;
  const guidePattern = /The current pin is `codex-openai-proxy@([^`]+)`, which bundles `@openai\/codex@([^`]+)`\./;

  const sourcePath = targetPaths.source;
  const initialSource = await readFile(resolve(repositoryRoot, sourcePath), 'utf8');
  const initialVersion = captureVersion(initialSource, sourcePattern, sourcePath);
  const targetVersion = normalizeTargetVersion(input, initialVersion);
  const bundledCodexVersion = await fetchBundledCodexVersion(targetVersion);

  const entries = await Promise.all(Object.entries(targetPaths).map(async ([key, path]) => {
    const absolutePath = resolve(repositoryRoot, path);
    return [key, { path, absolutePath, content: await readFile(absolutePath, 'utf8') }];
  }));
  const files = Object.fromEntries(entries);
  const currentVersion = captureVersion(files.source.content, sourcePattern, files.source.path);
  if (normalizeTargetVersion(input, currentVersion) !== targetVersion) {
    throw new Error('The current proxy version changed while reading the npm registry. Run the update again.');
  }

  const updates = {
    source: replaceVersion(
      files.source.content,
      sourcePattern,
      `export const codexProxyVersion = '${targetVersion}';`,
      files.source.path,
    ),
    test: replaceVersion(
      files.test.content,
      testPattern,
      `\`codex-openai-proxy@${targetVersion}\`, 'serve'`,
      files.test.path,
    ),
    operations: replaceVersion(
      files.operations.content,
      operationsPattern,
      `npx --yes codex-openai-proxy@${targetVersion} serve`,
      files.operations.path,
    ),
    developerGuide: replaceVersion(
      files.developerGuide.content,
      guidePattern,
      `The current pin is \`codex-openai-proxy@${targetVersion}\`, which bundles \`@openai/codex@${bundledCodexVersion}\`.`,
      files.developerGuide.path,
    ),
  };

  const changedPaths = [];
  await Promise.all(Object.entries(updates).map(async ([key, content]) => {
    if (content === files[key].content) return;
    await writeFile(files[key].absolutePath, content, 'utf8');
    changedPaths.push(files[key].path);
  }));

  process.stdout.write(`Codex proxy: ${currentVersion} -> ${targetVersion}\n`);
  process.stdout.write(`Bundled @openai/codex: ${bundledCodexVersion}\n`);
  process.stdout.write(changedPaths.length > 0
    ? `Updated:\n${changedPaths.map(path => `- ${path}`).join('\n')}\n`
    : 'All operational references are already current.\n');
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Could not update the Codex proxy: ${message}\n`);
  process.exitCode = 1;
}
