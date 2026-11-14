/** Assemble one finalized DLL recording into a streaming ZIP64 package. */
import { constants } from 'node:fs';
import { mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';

// libuv's UV_FS_O_EXLOCK denies Windows read/write/delete sharing. Node does not export it.
const exclusiveLock = process.platform === 'win32' ? 0x10000000 : 0;

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

/** Write a ZIP64 package to a temporary path, denying Windows copies until the stream closes. */
async function writeArchive(files, partialPath, gameId) {
  const zipfile = new yazl.ZipFile();
  const handle = await open(partialPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | exclusiveLock);
  const output = handle.createWriteStream();
  /** Close the destination stream when yazl reports an archive error. */
  const zipError = (error) => zipfile.outputStream.destroy(error);
  zipfile.on('error', zipError);
  const completed = pipeline(zipfile.outputStream, output);
  try {
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
  } catch (error) {
    zipfile.outputStream.destroy(error);
    await completed.catch(() => {});
    throw error;
  }
}

/** Rebuild the game's ZIP beside the old one and replace it only after the new one is complete. */
async function publishArchive(sourceRoot, outputDirectory) {
  const gameId = sourceRoot.split(/[\\/]/).filter(Boolean).at(-1);
  if (!gameId) throw new Error('Source directory must have a game ID name');
  const files = await recordingFiles(sourceRoot);
  if (files.length === 0) throw new Error('Recording source contains no package files');
  const finalPath = join(outputDirectory, `${gameId}.zip`);
  const partialPath = join(outputDirectory, `.${gameId}.${process.pid}.partial`);
  try {
    await writeArchive(files, partialPath, gameId);
    await rename(partialPath, finalPath);
  } catch (error) {
    try {
      await unlink(partialPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        process.stderr.write(`archive-raw: failed to remove incomplete ZIP ${partialPath}: ${cleanupError.message}\n`);
      }
    }
    throw error;
  }
  return finalPath;
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
