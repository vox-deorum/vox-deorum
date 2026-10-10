/**
 * @module web/routes/debug
 *
 * Debug page API: toggles Civ 5's own logging, reads log files from each VD service and from
 * Civ 5, and streams everything as one zip for bug reports.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errors.js';
import { sendError } from '../http-utils.js';
import config from '../../utils/config.js';
import { getCiv5UserFilePath } from '../../utils/game/civ5-user-files.js';
import { readCivLoggingEnabledContent, updateCivLoggingEnabledContent } from '../../utils/game/civ5-ini.js';
import {
  debugLogSources,
  isDebugLogSource,
  listLogFiles,
  readLogTail,
  resolveLogSourceDirs,
  type LogSourceDirs
} from '../../utils/debug/log-sources.js';
import { createLogBundle, logBundleFileName } from '../../utils/debug/log-bundle.js';
import type {
  DebugLogFile,
  DebugLogFileResponse,
  DebugLogSource,
  DebugStatusResponse,
  ErrorResponse,
  SetCivLoggingRequest,
  SetCivLoggingResponse
} from '../../types/index.js';

const logger = createLogger('debug', 'webui');

/** Largest slice of one log file sent to the browser. */
export const maxLogTailBytes = 512 * 1024;

/** Paths the debug routes work with. */
export interface DebugPaths {
  dirs: LogSourceDirs;
  civConfigPath: string;
  civModsDir: string;
}

/** Find the real log folders, Civ 5 config.ini, and Civ 5 MODS folder. */
async function resolveDebugPaths(): Promise<DebugPaths> {
  return {
    dirs: await resolveLogSourceDirs(),
    civConfigPath: await getCiv5UserFilePath('config.ini'),
    civModsDir: await getCiv5UserFilePath('MODS')
  };
}

/** Read Civ 5's LoggingEnabled value, or undefined when config.ini cannot be read. */
async function readCivLogging(configPath: string): Promise<boolean | undefined> {
  try {
    return readCivLoggingEnabledContent(await fs.readFile(configPath, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Build the debug router. Tests pass their own paths; the server uses the real ones,
 * resolved once because finding the Documents folder starts PowerShell.
 */
export function createDebugRoutes(resolvePaths: () => Promise<DebugPaths> = resolveDebugPaths): Router {
  const router = Router();
  let pathsPromise: Promise<DebugPaths> | undefined;
  const getPaths = () => (pathsPromise ??= resolvePaths());

  router.get('/status', async (_req: Request, res: Response<DebugStatusResponse | ErrorResponse>) => {
    try {
      const { dirs, civConfigPath } = await getPaths();
      const lists = await Promise.all(debugLogSources.map(source => listLogFiles(dirs[source])));
      const sources = Object.fromEntries(
        debugLogSources.map((source, index) => [source, lists[index]])
      ) as Record<DebugLogSource, DebugLogFile[]>;
      res.json({ civLogging: (await readCivLogging(civConfigPath)) ?? false, sources });
    } catch (error) {
      logger.error('Failed to read debug status', { error });
      sendError(res, 500, errorMessage(error, 'Unexpected error'));
    }
  });

  router.put('/civ-logging', async (req: Request<object, object, SetCivLoggingRequest>, res: Response<SetCivLoggingResponse | ErrorResponse>) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      sendError(res, 400, 'enabled must be true or false');
      return;
    }

    try {
      const { civConfigPath } = await getPaths();
      let content = '';
      try {
        content = await fs.readFile(civConfigPath, 'utf-8');
      } catch (error) {
        // Only a missing file starts fresh. Any other read failure must not overwrite existing settings.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await fs.mkdir(path.dirname(civConfigPath), { recursive: true });
      }
      await fs.writeFile(civConfigPath, updateCivLoggingEnabledContent(content, enabled), 'utf-8');
      logger.info(`Civ 5 logging turned ${enabled ? 'on' : 'off'} in ${civConfigPath}`);
      res.json({ civLogging: enabled });
    } catch (error) {
      logger.error('Failed to update Civ 5 logging', { error });
      sendError(res, 500, errorMessage(error, 'Unexpected error'));
    }
  });

  router.get('/logs/:source/:file', async (req: Request, res: Response<DebugLogFileResponse | ErrorResponse>) => {
    const { source, file } = req.params;
    if (!isDebugLogSource(source)) {
      sendError(res, 404, 'Unknown log source');
      return;
    }

    try {
      const { dirs } = await getPaths();
      // Only names from the folder listing are readable, so a crafted path cannot escape it.
      const listed = (await listLogFiles(dirs[source])).find(entry => entry.name === file);
      if (!listed) {
        sendError(res, 404, 'Log file not found');
        return;
      }

      const tail = await readLogTail(path.join(dirs[source], listed.name), maxLogTailBytes);
      res.json({ source, name: listed.name, ...tail });
    } catch (error) {
      logger.error(`Failed to read log ${source}/${file}`, { error });
      sendError(res, 500, errorMessage(error, 'Unexpected error'));
    }
  });

  router.get('/bundle', async (_req: Request, res: Response) => {
    try {
      const { dirs, civConfigPath, civModsDir } = await getPaths();
      const bundle = await createLogBundle({
        dirs,
        modsDir: civModsDir,
        civLogging: await readCivLogging(civConfigPath),
        version: config.versionInfo?.version || 'unknown'
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${logBundleFileName()}"`);
      res.on('close', () => {
        if (!res.writableFinished) bundle.destroy();
      });
      bundle.stream.on('error', (error) => {
        logger.error('Log bundle stream failed', { error });
        res.destroy(error);
      });
      bundle.stream.pipe(res);
    } catch (error) {
      logger.error('Failed to build log bundle', { error });
      sendError(res, 500, errorMessage(error, 'Unexpected error'));
    }
  });

  return router;
}
