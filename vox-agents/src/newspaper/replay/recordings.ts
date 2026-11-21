import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const archiveDirectory = fileURLToPath(new URL('../../../../mcp-server/archive/', import.meta.url));

/** Find the latest archived knowledge database by its archive timestamp. */
export async function latestRecording(directory = archiveDirectory): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(directory, { recursive: true, withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
  let latest: string | null = null;
  let timestamp = -1;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // MCP archives knowledge as <gameId>_<timestamp>.db and telemetry as <gameId>-player-<id>.db.
    const match = /_(\d{13})\.db$/i.exec(entry.name);
    if (!match) continue;
    const archivedAt = Number(match[1]);
    if (archivedAt < timestamp) continue;
    const candidate = join(entry.parentPath, entry.name);
    if (archivedAt > timestamp || latest === null || candidate < latest) {
      latest = candidate;
      timestamp = archivedAt;
    }
  }
  return latest;
}
