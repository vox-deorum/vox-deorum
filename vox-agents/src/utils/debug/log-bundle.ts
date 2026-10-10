/**
 * @module utils/debug/log-bundle
 *
 * Packs every log source plus a short setup summary into one zip that players can attach to a
 * bug report. The summary names versions, installed mods, and included files. It never reads
 * API keys, `.env`, or config JSON.
 */

import fs, { type FileHandle } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Readable } from 'stream';
import yazl from 'yazl';
import { debugLogSources, listLogFiles, type LogSourceDirs } from './log-sources.js';
import type { DebugLogFile, DebugLogSource } from '../../types/index.js';
import { errorMessage } from '../errors.js';

/** Folder name used inside the zip for each source. */
const bundleFolders: Record<DebugLogSource, string> = {
  agents: 'vox-agents',
  bridge: 'bridge-service',
  mcp: 'mcp-server',
  civ5: 'civ5'
};

/**
 * Largest slice taken from any one file. Bigger files, such as the DLL's connection-pipe.log
 * during a long game, contribute only their newest bytes.
 */
export const bundleTailBytes = 10 * 1024 * 1024;

/** Inputs for building a log bundle. */
export interface LogBundleOptions {
  dirs: LogSourceDirs;
  /** Civ 5 MODS folder, listed by name in setup.txt. */
  modsDir: string;
  /** Civ 5 LoggingEnabled value, or undefined when config.ini could not be read. */
  civLogging: boolean | undefined;
  version: string;
  /** Override for bundleTailBytes. */
  tailBytes?: number;
}

/** A zip being streamed, with a way to release open files if the download is abandoned. */
export interface LogBundle {
  stream: Readable;
  destroy(): void;
}

/** Build the bundle file name from a local timestamp, for example `vox-deorum-logs-20261001-142500.zip`. */
export function logBundleFileName(now: Date = new Date()): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `vox-deorum-logs-${date}-${time}.zip`;
}

/** List the folder names inside Civ 5's MODS folder. */
async function listModFolders(modsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(modsDir, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  } catch {
    return [];
  }
}

/**
 * Keep only the newest file of each rotated service log, for example the newest of `combined.log`,
 * `combined1.log`, ... and the newest `error*.log`. Older rotations are left out of the bundle.
 */
export function pickLatestLogs(files: DebugLogFile[]): { kept: DebugLogFile[]; left: DebugLogFile[] } {
  const newestFirst = [...files].sort((a, b) => b.modified.localeCompare(a.modified));
  const families = new Set<string>();
  const kept: DebugLogFile[] = [];
  const left: DebugLogFile[] = [];

  for (const file of newestFirst) {
    const family = file.name.toLowerCase().replace(/\d*\.log$/, '');
    if (families.has(family)) {
      left.push(file);
    } else {
      families.add(family);
      kept.push(file);
    }
  }
  return { kept, left };
}

/**
 * Open every log file and start streaming the zip. Files that cannot be opened are listed in setup.txt.
 * A read or zip error mid-stream closes every file and fails the output stream with that error.
 */
export async function createLogBundle(options: LogBundleOptions): Promise<LogBundle> {
  const opened: { handle: FileHandle; start: number; entryName: string; mtime: Date }[] = [];
  const included: string[] = [];
  const skipped: string[] = [];
  let leftOut = 0;
  const tailBytes = options.tailBytes ?? bundleTailBytes;

  for (const source of debugLogSources) {
    const dir = options.dirs[source];
    const files = await listLogFiles(dir);
    // Civ 5 rewrites its logs on every launch, so all of them are current. Services rotate.
    const { kept, left } = source === 'civ5' ? { kept: files, left: [] } : pickLatestLogs(files);
    leftOut += left.length;

    for (const file of kept) {
      const entryName = `${bundleFolders[source]}/${file.name}`;
      try {
        // Opening up front means a locked or vanished file is skipped here, not mid-stream.
        const handle = await fs.open(path.join(dir, file.name), 'r');
        const start = Math.max(0, file.size - tailBytes);
        opened.push({ handle, start, entryName, mtime: new Date(file.modified) });
        included.push(`${entryName} (${start > 0 ? `last ${tailBytes} of ${file.size}` : file.size} bytes)`);
      } catch (error) {
        skipped.push(`${entryName}: ${errorMessage(error)}`);
      }
    }
  }

  const mods = await listModFolders(options.modsDir);
  const civLogging = options.civLogging === undefined ? 'unknown' : options.civLogging ? 'on' : 'off';
  const setup = [
    `Vox Deorum ${options.version}`,
    `Created: ${new Date().toISOString()}`,
    `Platform: ${os.platform()} ${os.release()} (${os.arch()}), Node ${process.version}`,
    `Civ 5 logging: ${civLogging}`,
    '',
    `Mods (${mods.length}):`,
    ...mods.map(name => `  ${name}`),
    '',
    `Included files (${included.length}):`,
    ...included.map(line => `  ${line}`),
    ...(skipped.length > 0 ? ['', `Skipped files (${skipped.length}):`, ...skipped.map(line => `  ${line}`)] : []),
    ...(leftOut > 0 ? ['', `Older rotated service logs left out: ${leftOut}`] : []),
    ''
  ].join('\r\n');

  // Build the zip after the last await, so no file is read before the caller can listen for errors.
  const zip = new yazl.ZipFile();
  const output = zip.outputStream as Readable;
  const fileStreams = opened.map(file => file.handle.createReadStream({ start: file.start }));
  /** Close every opened file. */
  const destroy = () => {
    for (const stream of fileStreams) stream.destroy();
  };
  /** Stop the bundle and pass the error to whoever reads the output stream. */
  const fail = (error: Error) => {
    destroy();
    output.destroy(error);
  };

  zip.on('error', fail);
  opened.forEach((file, index) => {
    fileStreams[index].on('error', fail);
    zip.addReadStream(fileStreams[index], file.entryName, { mtime: file.mtime });
  });
  zip.addBuffer(Buffer.from(setup, 'utf8'), 'setup.txt');
  zip.end();

  return { stream: output, destroy };
}
