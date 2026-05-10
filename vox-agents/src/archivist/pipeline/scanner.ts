/**
 * @module archivist/pipeline/scanner
 *
 * Archive filesystem scanner that discovers game databases and identifies
 * LLM-controlled players. Walks experiment subdirectories under the archive
 * path, classifies database files by regex, and queries each game DB for
 * FlavorChanges to distinguish LLM players from VPAI players.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../../utils/logger.js';
import { GAME_DB_REGEX, openReadonlyGameDb } from '../../utils/telemetry/knowledge-db.js';
import type { ArchiveEntry, PlayerEntry } from '../types.js';

const logger = createLogger('ArchivistScanner');

/** Regex for telepathist database files (checked first to exclude from telemetry match) */
const TELEPATHIST_DB_REGEX = /^(.+)-player-(\d+)\.telepathist\.db$/;

/** Regex for telemetry database files: {gameId}-player-{playerId}.db */
const TELEMETRY_DB_REGEX = /^(.+)-player-(\d+)\.db$/;

/**
 * Scans the archive directory for game databases and identifies LLM-controlled players.
 *
 * For each experiment subdirectory, classifies .db files into game DBs, telemetry DBs,
 * and telepathist DBs. Opens each game DB to query FlavorChanges for LLM player detection.
 * Only returns games with at least one LLM-controlled player that has a telemetry DB.
 *
 * @param archivePath - Root archive directory containing experiment subdirectories
 * @param gameFilter - Optional: only process this specific game ID
 * @returns Discovered archive entries with their LLM players
 */
export async function scanArchive(
  archivePath: string,
  gameFilter?: string
): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];

  // Read archive directory — supports both flat layout and experiment subdirectories
  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(archivePath, { withFileTypes: true });
  } catch (error) {
    logger.error(`Failed to read archive directory: ${archivePath}`, { error });
    return [];
  }

  const experimentDirs = dirEntries
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  // If archive root contains .db files directly, treat it as a flat archive
  const hasRootDbFiles = dirEntries.some((e) => e.isFile() && e.name.endsWith('.db'));
  if (hasRootDbFiles) {
    experimentDirs.unshift('.'); // scan root as an implicit experiment
  }

  let totalGames = 0;
  let totalPlayers = 0;

  for (const experiment of experimentDirs) {
    const experimentPath = path.join(archivePath, experiment);
    let files: string[];

    try {
      files = fs.readdirSync(experimentPath);
    } catch (error) {
      logger.warn(`Failed to read experiment directory: ${experimentPath}`, { error });
      continue;
    }

    // Classify files by type
    const gameDbMap = new Map<string, string>(); // gameId -> dbPath
    const telemetryDbMap = new Map<string, Map<number, string>>(); // gameId -> (playerId -> dbPath)
    const telepathistDbMap = new Map<string, Map<number, string>>(); // gameId -> (playerId -> dbPath)

    for (const file of files) {
      // Check telepathist DB first (to exclude from telemetry regex)
      const telepathistMatch = TELEPATHIST_DB_REGEX.exec(file);
      if (telepathistMatch) {
        const [, gameId, playerIdStr] = telepathistMatch;
        const playerId = parseInt(playerIdStr, 10);
        if (!telepathistDbMap.has(gameId)) {
          telepathistDbMap.set(gameId, new Map());
        }
        telepathistDbMap.get(gameId)!.set(playerId, path.join(experimentPath, file));
        continue;
      }

      // Check telemetry DB (must not end with .telepathist.db, already handled above)
      const telemetryMatch = TELEMETRY_DB_REGEX.exec(file);
      if (telemetryMatch && !file.endsWith('.telepathist.db')) {
        const [, gameId, playerIdStr] = telemetryMatch;
        const playerId = parseInt(playerIdStr, 10);
        if (!telemetryDbMap.has(gameId)) {
          telemetryDbMap.set(gameId, new Map());
        }
        telemetryDbMap.get(gameId)!.set(playerId, path.join(experimentPath, file));
        continue;
      }

      // Check game DB
      const gameMatch = GAME_DB_REGEX.exec(file);
      if (gameMatch) {
        const [, gameId] = gameMatch;
        // Keep the latest timestamp if multiple game DBs exist for the same gameId
        gameDbMap.set(gameId, path.join(experimentPath, file));
      }
    }

    // Process each game that has a game DB
    for (const [gameId, gameDbPath] of gameDbMap) {
      const db = openReadonlyGameDb(gameDbPath);
      if (!db) {
        continue;
      }

      try {
        // Query FlavorChanges to find LLM player IDs
        // FlavorChanges uses PascalCase columns (Key, IsLatest) because the SQLite DB uses PascalCase
        const flavorRows = await db
          .selectFrom('FlavorChanges')
          .select('Key')
          .where('IsLatest', '=', 1)
          .groupBy('Key')
          .execute();

        const llmPlayerIds = new Set(flavorRows.map((r) => r.Key));

        if (llmPlayerIds.size === 0) {
          logger.warn(`No LLM players found for game ${gameId}, skipping`);
          continue;
        }

        const players: PlayerEntry[] = [];
        const telemetryPlayers = telemetryDbMap.get(gameId);

        for (const playerId of llmPlayerIds) {
          const telemetryPath = telemetryPlayers?.get(playerId);
          if (!telemetryPath) {
            logger.warn(`LLM player ${playerId} in game ${gameId} has no telemetry DB, skipping`);
            continue;
          }

          // Derive telepathist DB path (may not exist yet, will be created by telepathist-prep)
          const telepathistPath =
            telepathistDbMap.get(gameId)?.get(playerId) ??
            telemetryPath.replace(/\.db$/, '.telepathist.db');

          players.push({
            playerId,
            telemetryDbPath: telemetryPath,
            telepathistDbPath: telepathistPath,
          });
        }

        if (players.length > 0) {
          entries.push({
            experiment,
            gameId,
            gameDbPath,
            players,
          });
          totalGames++;
          totalPlayers += players.length;
        }
      } catch (error) {
        logger.error(`Error processing game ${gameId} in experiment ${experiment}`, { error });
      } finally {
        await db.destroy().catch(() => {});
      }
    }
  }

  // Apply game filter if specified
  const filtered = gameFilter
    ? entries.filter((e) => e.gameId === gameFilter)
    : entries;

  const filteredGames = filtered.length;
  const filteredPlayers = filtered.reduce((sum, e) => sum + e.players.length, 0);
  logger.info(`Archive scan complete: ${filteredGames} games found, ${filteredPlayers} total LLM players`);
  return filtered;
}
