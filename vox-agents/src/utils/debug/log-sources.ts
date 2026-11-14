/**
 * @module utils/debug/log-sources
 *
 * Locates the log folders shown on the dashboard's Debug page and reads files from them.
 * The three services sit side by side in the install folder, each writing to its own `logs`
 * folder, and Civ 5 writes to `Logs` under its My Games folder.
 */

import fs from 'fs/promises';
import path from 'path';
import { logsDir } from '../logger.js';
import { getCiv5UserFilePath } from '../../game/civ5-user-files.js';
import type { DebugLogFile, DebugLogSource } from '../../types/index.js';

/** Every source, in the order the Debug page and the bundle present them. */
export const debugLogSources: DebugLogSource[] = ['agents', 'bridge', 'mcp', 'civ5'];

/** Folder for each log source. */
export type LogSourceDirs = Record<DebugLogSource, string>;

/** Resolve each source's folder, using vox-agents' own logs folder to find its sibling services. */
export async function resolveLogSourceDirs(): Promise<LogSourceDirs> {
  const installRoot = path.dirname(path.dirname(logsDir));
  return {
    agents: logsDir,
    bridge: path.join(installRoot, 'bridge-service', 'logs'),
    mcp: path.join(installRoot, 'mcp-server', 'logs'),
    civ5: await getCiv5UserFilePath('Logs')
  };
}

/** Check whether a value names a known log source. */
export function isDebugLogSource(value: string): value is DebugLogSource {
  return (debugLogSources as string[]).includes(value);
}

/** List the top-level `.log` files in a folder, newest first. A missing folder gives an empty list. */
export async function listLogFiles(dir: string): Promise<DebugLogFile[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.log'))
    .map(async (entry): Promise<DebugLogFile | undefined> => {
      try {
        const stats = await fs.stat(path.join(dir, entry.name));
        return { name: entry.name, size: stats.size, modified: stats.mtime.toISOString() };
      } catch {
        return undefined;
      }
    }));

  return files
    .filter((file): file is DebugLogFile => file !== undefined)
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Read up to `maxBytes` from the end of a file, starting at a whole line when the file is cut. */
export async function readLogTail(
  filePath: string,
  maxBytes: number
): Promise<{ size: number; truncated: boolean; content: string }> {
  const handle = await fs.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    let content = buffer.subarray(0, bytesRead).toString('utf8');

    if (start > 0) {
      const firstBreak = content.indexOf('\n');
      content = firstBreak >= 0 ? content.slice(firstBreak + 1) : '';
    }

    return { size, truncated: start > 0, content };
  } finally {
    await handle.close();
  }
}
