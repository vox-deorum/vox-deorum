/**
 * Downloads the pinned texconv executable and its license into vox-agents/vendor/texconv.
 * The build uses this during developer setup, so issue generation never downloads anything.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const vendorDir = join(repositoryRoot, 'vox-agents', 'vendor', 'texconv');
const executablePath = join(vendorDir, 'texconv.exe');
const licensePath = join(vendorDir, 'LICENSE');

/** Pinned DirectXTex release and the published converter executable. */
const texconvVersion = 'may2026';
const texconvUrl = `https://github.com/microsoft/DirectXTex/releases/download/${texconvVersion}/texconv.exe`;
const texconvSha256 = 'dcfdec10244e02cf5037fba089c55fb7e1326b1c8181742d77d15fa5cb5eef06';

/** License file published with the same DirectXTex release tag. */
const licenseUrl = `https://raw.githubusercontent.com/microsoft/DirectXTex/${texconvVersion}/LICENSE`;

/** Upper bound for each download, so a stalled connection cannot hang the build. */
const downloadTimeoutMs = 120_000;

/** Fetches one URL into a buffer and reports HTTP failures. */
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(downloadTimeoutMs) });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Returns the lowercase hexadecimal SHA-256 digest of a buffer. */
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Reports whether a file exists and holds at least one byte. */
async function hasContent(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

/** Reports whether the installed executable is already the pinned build. */
async function hasPinnedExecutable() {
  try {
    return sha256(await readFile(executablePath)) === texconvSha256;
  } catch {
    return false;
  }
}

/**
 * Acquires both files. Downloads stay in a staging folder inside the destination so the final
 * rename is atomic, and the executable is only published after its checksum matches.
 */
async function main() {
  await mkdir(vendorDir, { recursive: true });
  if (await hasPinnedExecutable() && await hasContent(licensePath)) {
    process.stdout.write('texconv: pinned executable and license already present.\n');
    return;
  }

  const stagingDir = await mkdtemp(join(vendorDir, '.acquire-'));
  try {
    if (await hasPinnedExecutable()) {
      process.stdout.write('texconv: pinned executable already present.\n');
    } else {
      process.stdout.write(`texconv: downloading ${texconvVersion} from DirectXTex...\n`);
      const executable = await download(texconvUrl);
      const actualSha256 = sha256(executable);
      if (actualSha256 !== texconvSha256) {
        throw new Error(
          `texconv checksum mismatch: expected ${texconvSha256}, received ${actualSha256}. Nothing was published.`,
        );
      }
      const stagedExecutable = join(stagingDir, 'texconv.exe');
      await writeFile(stagedExecutable, executable);
      await rename(stagedExecutable, executablePath);
      process.stdout.write(`texconv: verified and published ${executablePath}\n`);
    }

    if (!await hasContent(licensePath)) {
      process.stdout.write(`texconv: downloading the ${texconvVersion} license...\n`);
      const license = await download(licenseUrl);
      if (license.length === 0) {
        throw new Error('DirectXTex license download was empty.');
      }
      const stagedLicense = join(stagingDir, 'LICENSE');
      await writeFile(stagedLicense, license);
      await rename(stagedLicense, licensePath);
      process.stdout.write(`texconv: retained ${licensePath}\n`);
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`texconv: ${message}\n`);
  process.exitCode = 1;
}
