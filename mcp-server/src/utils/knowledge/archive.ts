/**
 * Archive utility for backing up game saves and database files
 */

import fs from 'fs/promises';
import path from 'path';
import { getDocumentsPath } from '../config.js';
import { createLogger } from '../logger.js';
import { knowledgeManager } from '../../server.js';

const logger = createLogger('Archive');

/**
 * Information about a save file
 */
interface SaveFileInfo {
  path: string;
  name: string;
  modifiedTime: Date;
}

/**
 * Generic function to find the latest file with a specific extension in a directory
 */
async function findLatestFile(
  directoryPath: string,
  extension: string,
  fileType: string
): Promise<SaveFileInfo | null> {
  try {
    // Check if directory exists
    try {
      await fs.access(directoryPath);
    } catch (error) {
      logger.warn(`${fileType} directory does not exist: ${directoryPath}`);
      return null;
    }

    // Read all files in the directory
    const files = await fs.readdir(directoryPath);

    // Filter for files with the specified extension and get their stats
    const matchingFiles: SaveFileInfo[] = [];
    for (const file of files) {
      if (file.endsWith(extension)) {
        const filePath = path.join(directoryPath, file);
        const stats = await fs.stat(filePath);
        matchingFiles.push({
          path: filePath,
          name: file,
          modifiedTime: stats.mtime
        });
      }
    }

    // Sort by modified time (newest first) and return the latest
    matchingFiles.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime());

    if (matchingFiles.length > 0) {
      logger.info(`Found latest ${fileType} file: ${matchingFiles[0].name}`);
      return matchingFiles[0];
    }

    logger.warn(`No ${fileType} files found`);
    return null;
  } catch (error) {
    logger.error(`Error finding latest ${fileType} file:`, error);
    return null;
  }
}

/**
 * Find the latest replay file for Civilization V
 */
export async function findLatestReplayFile(): Promise<SaveFileInfo | null> {
  const documentsPath = await getDocumentsPath();
  const replaysPath = path.join(documentsPath, 'My Games', 'Sid Meier\'s Civilization 5', 'Replays');
  return findLatestFile(replaysPath, '.Civ5Replay', 'replay');
}

/**
 * Find the latest save file for Civilization V
 */
export async function findLatestSaveFile(): Promise<SaveFileInfo | null> {
  const documentsPath = await getDocumentsPath();
  const savesPath = path.join(documentsPath, 'My Games', 'Sid Meier\'s Civilization 5', 'ModdedSaves', 'single', 'auto');
  return findLatestFile(savesPath, '.Civ5Save', 'save');
}

/**
 * Outcome of collecting the DLL's RL capture recording into the archive.
 */
export interface CaptureCollectionResult {
  /** True when the recording directory was moved; false when it was copied (rename unavailable). */
  moved: boolean;
  /** 'ok' — recording archived; 'absent' — no recording exists for this game; 'failed' — an error occurred. */
  status: 'ok' | 'absent' | 'failed';
  /** Error message when status is 'failed'. */
  detail?: string;
}

/**
 * Whether a path exists, with errors swallowed into a plain boolean.
 */
async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Collect the DLL's RL capture recording for a game into the archive.
 *
 * With VOX_RL_CAPTURE=1 the game DLL writes a recording tree under
 * `<Documents>/My Games/Sid Meier's Civilization 5/VoxDeorumRL/<game-id>/`.
 * The DLL finalizes the recording (final commit, handles released) when the
 * victory event fires, long before this runs, so the whole tree is moved
 * into `<capturesPath>/<game-id>/`. When the rename is not possible (a
 * cross-volume archive, or the DLL still holding the files open), the tree
 * is copied instead and the source is left in place.
 *
 * Never throws and never logs a summary itself: a missing recording reports
 * 'absent' (capture disabled or identity never established — not an error)
 * and errors report 'failed' with a detail message, so the caller decides
 * how to log the outcome.
 */
export async function collectCaptureRecording(gameId: string, capturesPath: string): Promise<CaptureCollectionResult> {
  try {
    const documentsPath = await getDocumentsPath();
    const captureRoot = path.join(documentsPath, 'My Games', 'Sid Meier\'s Civilization 5', 'VoxDeorumRL', gameId);

    // A missing recording means capture was disabled or the game identity was
    // never established — a normal state, so only a debug note.
    if (!await pathExists(captureRoot)) {
      logger.debug(`No capture recording for game ${gameId} (capture disabled or identity not established)`);
      return { moved: false, status: 'absent' };
    }

    const destinationRoot = path.join(capturesPath, gameId);
    await fs.mkdir(capturesPath, { recursive: true });
    // A stale destination from an earlier attempt must not block the move.
    await fs.rm(destinationRoot, { recursive: true, force: true });
    try {
      await fs.rename(captureRoot, destinationRoot);
      return { moved: true, status: 'ok' };
    } catch (renameError) {
      try {
        await fs.cp(captureRoot, destinationRoot, { recursive: true });
        logger.debug(`Capture recording for game ${gameId} copied instead of moved: ${String(renameError)}`);
        return { moved: false, status: 'ok' };
      } catch (copyError) {
        return { moved: false, status: 'failed', detail: String(copyError) };
      }
    }
  } catch (error) {
    return { moved: false, status: 'failed', detail: String(error) };
  }
}

/**
 * Archive the latest game save, replay, database, telemetry, and capture recording to a strategist-specific folder
 */
export async function archiveGameData(
  experimentOverride?: string
): Promise<{ savePath: string, dbPath: string, replayPath?: string, telemetryPaths?: string[] } | null> {
  try {
    // Get the strategist name from metadata or use override/default
    const store = knowledgeManager.getStore();
    const experiment = experimentOverride ?? await store.getMetadata('experiment') ?? "none";

    // Get the game ID
    const gameId = knowledgeManager.getGameId();
    if (!gameId) {
      logger.error('No game ID available');
      return null;
    }

    // Find the latest save file
    const latestSave = await findLatestSaveFile();
    if (!latestSave) {
      logger.error('No save file found to archive');
      return null;
    }

    // Create the archive directory
    const archivePath = path.join('archive', experiment);
    await fs.mkdir(archivePath, { recursive: true });
    logger.info(`Created archive directory: ${archivePath}`);

    // Copy the save file
    const saveFileName = `${gameId}_${Date.now()}.Civ5Save`;
    const saveDest = path.join(archivePath, saveFileName);
    await fs.copyFile(latestSave.path, saveDest);
    logger.info(`Archived save file: ${saveFileName}`);

    // Copy the database file
    const dbSource = path.join('data', `${gameId}.db`);
    const dbFileName = `${gameId}_${Date.now()}.db`;
    const dbDest = path.join(archivePath, dbFileName);

    try {
      await fs.access(dbSource);
      await fs.copyFile(dbSource, dbDest);
      logger.info(`Archived database file: ${dbFileName}`);
    } catch (error) {
      logger.warn(`Database file not found or could not be copied: ${dbSource}`);
      // Continue even if database doesn't exist
    }

    // Copy telemetry data files
    const telemetryPaths: string[] = [];
    const telemetrySourceDir = path.join('..', 'vox-agents', 'telemetry');

    try {
      await fs.access(telemetrySourceDir);
      const telemetryFiles = await fs.readdir(telemetrySourceDir, { recursive: true });

      // Filter for telemetry database files matching the game ID pattern
      const gameIdTelemetryFiles = telemetryFiles.filter(file => {
        // Match files like: {gameId}-player-{playerId}.db (and their WAL/SHM files)
        return path.basename(file).startsWith(gameId) && file.endsWith('.db');
      });

      // Copy each telemetry file
      for (const telemetryFile of gameIdTelemetryFiles) {
        const sourcePath = path.join(telemetrySourceDir, telemetryFile);
        const destPath = path.join(archivePath, path.basename(telemetryFile));

        try {
          await fs.copyFile(sourcePath, destPath);
          telemetryPaths.push(destPath);
          logger.info(`Archived telemetry file: ${telemetryFile}`);
        } catch (error) {
          logger.warn(`Could not copy telemetry file: ${telemetryFile}`, error);
        }
      }

      if (telemetryPaths.length > 0) {
        logger.info(`Archived ${telemetryPaths.length} telemetry files`);
      } else {
        logger.warn(`No telemetry files found for game ID: ${gameId}`);
      }
    } catch (error) {
      logger.error(`Telemetry directory not found or inaccessible: ${telemetrySourceDir}`);
      // Continue even if telemetry doesn't exist
    }

    // Copy the replay file if it exists
    let replayDest: string | undefined;
    const latestReplay = await findLatestReplayFile();
    if (latestReplay) {
      const replayFileName = `${gameId}_${Date.now()}.Civ5Replay`;
      replayDest = path.join(archivePath, replayFileName);
      try {
        await fs.copyFile(latestReplay.path, replayDest);
        logger.info(`Archived replay file: ${replayFileName}`);
      } catch (error) {
        logger.warn(`Replay file could not be copied: ${latestReplay.path}`, error);
        replayDest = undefined;
      }
    } else {
      logger.warn('No replay file found to archive');
    }

    // Collect the DLL's RL capture recording into the archive. The DLL
    // finalizes the recording when the victory event fires, so the whole
    // tree can be moved. The outcome is only logged here, and a capture
    // problem never fails the save/database/telemetry/replay artifacts
    // collected above.
    try {
      const captures = await collectCaptureRecording(gameId, path.join(archivePath, 'captures'));
      if (captures.status === 'ok') {
        logger.info(`Capture recording archived (${captures.moved ? 'moved' : 'copied'}) for game ${gameId}`);
      } else if (captures.status === 'failed') {
        logger.warn(`Failed to archive capture recording for game ${gameId}: ${captures.detail ?? 'unknown error'}`);
      }
      // 'absent' is a normal state (capture disabled); the helper already
      // logged it at debug level, so nothing more to report.
    } catch (error) {
      logger.warn('Capture recording archival failed unexpectedly:', error);
    }

    logger.info(`Successfully archived game data for experiment: ${experiment}`);
    return {
      savePath: saveDest,
      dbPath: dbDest,
      replayPath: replayDest,
      telemetryPaths: telemetryPaths.length > 0 ? telemetryPaths : undefined
    };
  } catch (error) {
    logger.error('Error archiving game data:', error);
    return null;
  }
}

