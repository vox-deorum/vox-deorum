/** Assemble one finalized DLL recording into a streaming ZIP64 package. */
import { createWriteStream } from 'node:fs';
import { link, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';

/** Return source files in stable order while excluding derived training data. */
async function recordingFiles(sourceRoot) {
  const files = [];
  /** Walk one recording directory and collect only eligible file paths. */
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'tactical-training') await visit(absolute);
      } else if (entry.isFile()) {
        const logical = relative(sourceRoot, absolute).split(sep).join('/');
        if (!logical.startsWith('tactical-training/')) files.push({ absolute, logical });
      }
    }
  }
  await visit(sourceRoot);
  return files;
}

/** Check whether a path exists without turning a missing path into an error. */
async function pathExists(target) {
  try { await stat(target); return true; } catch { return false; }
}

/** Rename a completed temporary package while refusing to replace an existing one. */
async function renameNoReplace(source, target) {
  await link(source, target);
  await unlink(source);
}

/** Stream source files into a ZIP64 package with stored stream members. */
async function writeArchive(sourceRoot, partialPath, gameId) {
  const files = await recordingFiles(sourceRoot);
  if (files.length === 0) throw new Error('Recording source contains no package files');
  const zipfile = new yazl.ZipFile();
  const output = createWriteStream(partialPath, { flags: 'wx' });
  /** Close the destination stream when yazl reports an archive error. */
  const zipError = (error) => zipfile.outputStream.destroy(error);
  zipfile.once('error', zipError);
  const completed = pipeline(zipfile.outputStream, output);
  for (const file of files) {
    const metadataPath = `${gameId}/${file.logical}`;
    const isStream = file.logical.split('/').at(-1) === 'stream.bin';
    zipfile.addFile(file.absolute, metadataPath, {
      compress: !isStream,
      forceZip64Format: true,
    });
  }
  zipfile.end({ forceZip64Format: true });
  await completed;
}

/** Publish a package without overwriting a package created by another process. */
async function publishArchive(sourceRoot, outputDirectory) {
  const gameId = sourceRoot.split(/[\\/]/).filter(Boolean).at(-1);
  if (!gameId) throw new Error('Source directory must have a game ID name');
  const finalPath = join(outputDirectory, `${gameId}.zip`);
  if (await pathExists(finalPath)) return finalPath;
  const partialPath = join(outputDirectory, `.${gameId}.${process.pid}.${Date.now()}.partial`);
  try {
    await writeArchive(sourceRoot, partialPath, gameId);
    await renameNoReplace(partialPath, finalPath);
    return finalPath;
  } catch (error) {
    try { await unlink(partialPath); } catch { /* best effort */ }
    if (await pathExists(finalPath)) return finalPath;
    throw error;
  }
}

/** Parse the manual archive command and validate its required positional paths. */
async function main() {
  const [sourceArgument, outputArgument, ...extra] = process.argv.slice(2);
  if (sourceArgument === '--help' || sourceArgument === '-h') {
    process.stdout.write('Usage: npm run archive:raw -- SOURCE_ROOT OUTPUT_DIRECTORY\n');
    return;
  }
  if (!sourceArgument || !outputArgument || extra.length > 0) {
    process.stderr.write('Usage: npm run archive:raw -- SOURCE_ROOT OUTPUT_DIRECTORY\n');
    process.exitCode = 2;
    return;
  }
  const sourceRoot = resolve(sourceArgument);
  const outputDirectory = resolve(outputArgument);
  const sourceStats = await stat(sourceRoot);
  if (!sourceStats.isDirectory()) throw new Error(`Recording source is not a directory: ${sourceRoot}`);
  await mkdir(outputDirectory, { recursive: true });
  process.stdout.write(`${await publishArchive(sourceRoot, outputDirectory)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`archive-raw: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
