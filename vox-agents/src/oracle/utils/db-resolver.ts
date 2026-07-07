/**
 * @module oracle/utils/db-resolver
 *
 * Auto-discovers telemetry database files for a given game/player pair.
 * Scans the telemetry directory for databases matching the naming convention
 * {gameId}-player-{playerId}.db, with caching to avoid repeated filesystem scans.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Kysely } from 'kysely';
import { openSqliteKyselyReadonly } from '../../utils/telemetry/sqlite-helpers.js';
import { createLogger } from '../../utils/logger.js';
import type { TelemetryDatabase } from '../../utils/telemetry/schema.js';

const logger = createLogger('OracleDbResolver');

/** Cache of resolved DB paths keyed by "gameId-playerId" */
const dbPathCache = new Map<string, string>();

/**
 * Discover the telemetry database file for a specific game/player pair.
 * Scans telemetry subdirectories for files matching {gameId}-player-{playerId}.db.
 *
 * @param gameId - Game ID from the CSV row
 * @param playerId - Player ID from the CSV row
 * @param telemetryDir - Root telemetry directory to scan
 * @returns Absolute path to the database file, or null if not found
 */
export function discoverDbPath(gameId: string, playerId: string, telemetryDir: string): string | null {
  const cacheKey = `${gameId}-${playerId}`;

  if (dbPathCache.has(cacheKey)) {
    return dbPathCache.get(cacheKey)!;
  }

  const targetFilename = `${gameId}-player-${playerId}.db`;

  // Scan telemetry subdirectories
  try {
    if (!fs.existsSync(telemetryDir)) {
      logger.warn(`Telemetry directory not found: ${telemetryDir}`);
      return null;
    }

    const entries = fs.readdirSync(telemetryDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const candidate = path.join(telemetryDir, entry.name, targetFilename);
      if (fs.existsSync(candidate)) {
        const resolved = path.resolve(candidate);
        dbPathCache.set(cacheKey, resolved);
        logger.debug(`Resolved DB for ${cacheKey}: ${resolved}`);
        return resolved;
      }
    }
  } catch (error) {
    logger.error(`Error scanning telemetry directory: ${telemetryDir}`, { error });
  }

  logger.warn(`No telemetry DB found for game=${gameId}, player=${playerId}`);
  return null;
}

/**
 * Open a telemetry database in read-only mode.
 *
 * @param dbPath - Absolute path to the SQLite database
 * @returns Kysely instance for querying, or null on failure
 */
export function openReadonlyDb(dbPath: string): Kysely<TelemetryDatabase> | null {
  try {
    return openSqliteKyselyReadonly<TelemetryDatabase>(dbPath).db;
  } catch (error) {
    logger.error(`Failed to open database: ${dbPath}`, { error });
    return null;
  }
}

/** Clear the DB path cache (useful for testing) */
export function clearDbCache(): void {
  dbPathCache.clear();
}
