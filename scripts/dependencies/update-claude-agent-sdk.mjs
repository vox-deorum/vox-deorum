/**
 * Updates the root Claude Agent SDK dependency and reports the Claude Code model mapping.
 */

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageName = '@anthropic-ai/claude-agent-sdk';
const packageJsonPath = resolve(repositoryRoot, 'package.json');
const installedManifestPath = resolve(repositoryRoot, 'node_modules', packageName, 'package.json');
const dependencyPattern = /("@anthropic-ai\/claude-agent-sdk": ")\^?(\d[^"]*)(")/;
const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const discoveryTimeoutMs = 10_000;

/** Returns the target version from the command line or the latest npm release. */
async function resolveTargetVersion() {
  const input = process.argv[2];
  if (process.argv.length > 3) {
    throw new Error('Usage: npm run update:claude-agent-sdk [-- <version>]');
  }
  if (input) {
    if (!exactVersionPattern.test(input)) {
      throw new Error(`Pass an exact version such as 0.3.293, not "${input}".`);
    }
    return input;
  }

  const url = `https://registry.npmjs.org/${packageName}/latest`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new Error(`Could not read ${packageName} from the npm registry.`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status} for ${packageName}.`);
  }
  const manifest = await response.json();
  if (typeof manifest.version !== 'string' || !exactVersionPattern.test(manifest.version)) {
    throw new Error(`npm registry returned an unexpected latest version: ${String(manifest.version)}.`);
  }
  return manifest.version;
}

/** Reads the installed SDK version, or a placeholder when it is not installed. */
async function readInstalledVersion() {
  try {
    const manifest = JSON.parse(await readFile(installedManifestPath, 'utf8'));
    return manifest.version ?? 'unknown';
  } catch {
    return 'not installed';
  }
}

/** Points the root dependency spec at the target version and returns the original file content. */
async function updateDependencySpec(targetVersion) {
  const content = await readFile(packageJsonPath, 'utf8');
  const matches = [...content.matchAll(new RegExp(dependencyPattern.source, 'g'))];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${packageName} version spec in package.json, found ${matches.length}.`);
  }
  const updated = content.replace(dependencyPattern, `$1^${targetVersion}$3`);
  if (updated !== content) await writeFile(packageJsonPath, updated, 'utf8');
  return content;
}

/** Runs npm install at the repository root and fails with a hint when it does not succeed. */
function runNpmInstall() {
  const result = spawnSync('npm', ['install'], { cwd: repositoryRoot, stdio: 'inherit', shell: true });
  if (result.error || result.status !== 0) {
    throw new Error(
      `npm install failed (exit ${result.status ?? 'unknown'}). If Vox Agents is running, stop it first, since it can lock the bundled Claude Code binary.`,
      { cause: result.error },
    );
  }
}

/** Bounds an operation with a deadline whose timer is always cleared. */
async function withDeadline(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Stops a Claude Code session without letting teardown errors escape. */
function terminateSession(session) {
  try {
    void session.interrupt?.().catch(() => undefined);
  } catch {
    // Interrupt is best-effort; close still tears the subprocess down.
  }
  try {
    session.close();
  } catch {
    // The subprocess may already be gone; nothing further is needed.
  }
}

/** Prints each Claude Code model alias with the model slug it resolves to. */
async function reportModelMapping() {
  // Imported only after npm install so the newly installed version is loaded.
  const { query } = await import(packageName);
  let session;
  try {
    session = query({ prompt: '', options: { settingSources: [] } });
    const models = await withDeadline(session.supportedModels(), discoveryTimeoutMs);
    if (models.length === 0) throw new Error('Claude Code returned no models');
    const rows = models.map((model) => `  ${model.value} => ${model.resolvedModel ?? '(not reported)'}`);
    process.stdout.write(`Claude Code model mapping:\n${rows.join('\n')}\n`);
  } finally {
    if (session) terminateSession(session);
  }
}

/** Updates the SDK, reinstalls, and reports the version change and model mapping. */
async function main() {
  const targetVersion = await resolveTargetVersion();
  const currentVersion = await readInstalledVersion();

  const originalPackageJson = await updateDependencySpec(targetVersion);
  try {
    runNpmInstall();
  } catch (error) {
    // Restore the old spec so package.json keeps matching the installed packages.
    await writeFile(packageJsonPath, originalPackageJson, 'utf8');
    throw error;
  }

  const installedVersion = await readInstalledVersion();
  process.stdout.write(currentVersion === installedVersion
    ? `Claude Agent SDK: already at ${installedVersion}\n`
    : `Claude Agent SDK: ${currentVersion} -> ${installedVersion}\n`);
  if (installedVersion !== targetVersion) {
    process.stderr.write(
      `Warning: requested ${targetVersion} but npm kept ${installedVersion}, which still satisfies ^${targetVersion}.\n`,
    );
  }

  try {
    await reportModelMapping();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Warning: could not read the Claude Code model mapping (${message}). Check that Claude Code is installed and signed in.\n`,
    );
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Could not update the Claude Agent SDK: ${message}\n`);
  process.exitCode = 1;
}
