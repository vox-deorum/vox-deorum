/**
 * @module utils/telemetry/knowledge-db
 *
 * Shared helpers for opening, discovering, and querying Civilization V
 * "knowledge" SQLite databases produced by the game/MCP pipeline.
 *
 * - `openReadonlyGameDb` — open a knowledge DB read-only via Kysely.
 * - `findKnowledgeDb` / `resolveKnowledgePath` — locate a DB by gameID under
 *   `mcp-server/archive/`.
 * - `getGameMetadataValue` / `getWinner` / `getPlayerStrategistMetadata` —
 *   thin wrappers around the `GameMetadata` key/value table.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Kysely, ParseJSONResultsPlugin } from 'kysely';
import { openSqliteKyselyReadonly } from './sqlite-helpers.js';
import { createLogger } from '../logger.js';
import type { KnowledgeDatabase } from '../../../../mcp-server/dist/knowledge/schema/index.js';

const logger = createLogger('KnowledgeDb');

/** Regex for game database files: `{gameId}_{timestamp}.db` */
export const GAME_DB_REGEX = /^(.+?)_(\d+)\.db$/;

/**
 * Opens a game knowledge database in read-only mode with JSON parsing support.
 *
 * @param dbPath - Absolute path to the SQLite database
 * @returns Kysely instance for querying, or null on failure
 */
export function openReadonlyGameDb(dbPath: string): Kysely<KnowledgeDatabase> | null {
  try {
    return openSqliteKyselyReadonly<KnowledgeDatabase>(dbPath, {
      plugins: [new ParseJSONResultsPlugin()],
    }).db;
  } catch (error) {
    logger.error(`Failed to open game database: ${dbPath}`, { error });
    return null;
  }
}

/**
 * Search `mcp-server/archive/` for a knowledge DB matching the gameID.
 *
 * Tries both the current cwd and the parent directory (for the common
 * monorepo layout where vox-agents is a sibling of mcp-server). Walks each
 * experiment subdirectory and returns the path with the latest timestamp,
 * or null if not found.
 */
export function findKnowledgeDb(gameID: string): string | null {
  let bestPath: string | null = null;
  let bestTimestamp = 0;

  const roots = [path.resolve('.'), path.resolve('..')];

  for (const root of roots) {
    const archiveDir = path.join(root, 'mcp-server', 'archive');
    if (!fs.existsSync(archiveDir)) continue;

    const experiments = fs.readdirSync(archiveDir, { withFileTypes: true });
    for (const entry of experiments) {
      if (!entry.isDirectory()) continue;
      const expDir = path.join(archiveDir, entry.name);
      const files = fs.readdirSync(expDir);

      for (const file of files) {
        const match = GAME_DB_REGEX.exec(file);
        if (match && match[1] === gameID) {
          const timestamp = parseInt(match[2], 10);
          if (timestamp > bestTimestamp) {
            bestTimestamp = timestamp;
            bestPath = path.join(expDir, file);
          }
        }
      }
    }
  }

  if (bestPath) {
    logger.info(`Found knowledge DB for ${gameID}: ${bestPath}`);
  } else {
    logger.warn(`No knowledge DB found for ${gameID} under any mcp-server/archive`);
  }

  return bestPath;
}

/**
 * Resolve a knowledge DB path: if `knowledgePath` is provided, use it
 * (resolved to absolute); otherwise search the archive for `gameID`.
 * Throws if no DB can be located or the resolved file does not exist.
 */
export function resolveKnowledgePath(
  knowledgePath: string | undefined,
  gameID: string,
): string {
  const resolved = knowledgePath
    ? path.resolve(knowledgePath)
    : findKnowledgeDb(gameID);

  if (!resolved) {
    throw new Error(
      `Could not find knowledge DB for game ${gameID}. ` +
      `Provide knowledgePath explicitly or ensure the DB exists in mcp-server/archive/.`
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Knowledge DB not found at ${resolved}`);
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// GameMetadata helpers
// ---------------------------------------------------------------------------

/** Single-row lookup against the `GameMetadata` key/value table. */
export async function getGameMetadataValue(
  db: Kysely<KnowledgeDatabase>,
  key: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('GameMetadata')
    .select('Value')
    .where('Key', '=', key)
    .executeTakeFirst();
  return row?.Value ?? null;
}

/**
 * Read winner info from `GameMetadata`. Returns null if no winner has been
 * recorded or `victoryPlayerID` is invalid (e.g. negative / non-numeric).
 */
export async function getWinner(
  db: Kysely<KnowledgeDatabase>,
): Promise<{ playerID: number; victoryType: string } | null> {
  const playerIDStr = await getGameMetadataValue(db, 'victoryPlayerID');
  if (playerIDStr == null) return null;

  const playerID = parseInt(playerIDStr, 10);
  if (isNaN(playerID) || playerID < 0) return null;

  const victoryType = (await getGameMetadataValue(db, 'victoryType')) ?? 'Unknown';
  return { playerID, victoryType };
}

/**
 * Read the strategist + model assigned to a given player from
 * `GameMetadata`. Returns nulls if either key is absent.
 */
export async function getPlayerStrategistMetadata(
  db: Kysely<KnowledgeDatabase>,
  playerID: number,
): Promise<{ strategist: string | null; model: string | null }> {
  const strategist = await getGameMetadataValue(db, `strategist-${playerID}`);
  const model = await getGameMetadataValue(db, `model-${playerID}`);
  return { strategist, model };
}
