/**
 * @module web/routes/config
 *
 * Configuration management API endpoints for reading and updating
 * config.json and .env files.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { createLogger } from '../../utils/logger.js';
import { loadVoxConfig, refreshConfig } from '../../utils/config.js';
import { defaultConfig } from '../../utils/config/defaults.js';
import { computeConfigDiff } from '../../utils/config/diff.js';
import type { ConfigResponse, ErrorResponse, VoxAgentsConfig } from '../../types/index.js';

const logger = createLogger('config', 'webui');
const router = Router();

/**
 * Format environment variables into .env file content
 * Properly handles multi-line values by using double quotes and escaping
 */
function formatEnvFile(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => {
      // Check if value contains newlines or needs quoting
      if (value.includes('\n') || value.includes('"')) {
        // Escape existing backslashes and quotes, then quote the value
        const escaped = value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n');
        return `${key}="${escaped}"`;
      }
      // Simple values don't need quotes
      return `${key}=${value}`;
    })
    .join('\n') + '\n';
}

/**
 * GET /api/config
 * Get current configuration from config.json and .env
 */
router.get('/', async (_req: Request, res: Response<ConfigResponse | ErrorResponse>) => {
  try {
    // Load config.json (deep-merges diff with defaults)
    const config = loadVoxConfig('config.json');

    // Load .env file
    const envPath = path.join(process.cwd(), '.env');
    let apiKeys: Record<string, string> = {};

    try {
      const envContent = await fs.readFile(envPath, 'utf-8');
      apiKeys = dotenv.parse(envContent);
    } catch (error) {
      logger.debug('.env file not found or could not be read');
    }

    res.json({
      config,
      apiKeys
    });
  } catch (error) {
    logger.error('Error loading configuration', error);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

/**
 * GET /api/config/check
 * Check if .env file exists
 */
router.get('/check', async (_req: Request, res: Response<{ exists: boolean } | ErrorResponse>) => {
  try {
    const envPath = path.join(process.cwd(), '.env');

    try {
      await fs.access(envPath);
      res.json({ exists: true });
    } catch {
      res.json({ exists: false });
    }
  } catch (error) {
    logger.error('Error checking .env file', error);
    res.status(500).json({ error: 'Failed to check .env file' });
  }
});

/**
 * POST /api/config
 * Update configuration in config.json and .env
 */
router.post('/', async (req: Request<{}, {}, Partial<ConfigResponse>>, res: Response<{ success: boolean } | ErrorResponse>) => {
  try {
    const { config, apiKeys } = req.body;

    // Update config.json if config provided
    if (config) {
      const configPath = path.join(process.cwd(), 'config.json');

      // Compute diff against defaults — only persist what changed
      const configDiff = computeConfigDiff(config as VoxAgentsConfig, defaultConfig);

      // Write only the diff
      await fs.writeFile(configPath, JSON.stringify(configDiff, null, 2));
      logger.info('Updated config.json');

      // Refresh the in-memory configuration
      refreshConfig();
      logger.info('Refreshed system configuration');
    }

    // Update .env if API keys provided
    if (apiKeys) {
      const envPath = path.join(process.cwd(), '.env');

      // Read existing .env and merge — new keys override, existing keys preserved
      let existingKeys: Record<string, string> = {};
      try {
        const existingContent = await fs.readFile(envPath, 'utf-8');
        existingKeys = dotenv.parse(existingContent);
      } catch {
        // .env doesn't exist yet, start fresh
      }

      const mergedKeys = { ...existingKeys, ...apiKeys };
      await fs.writeFile(envPath, formatEnvFile(mergedKeys));
      logger.info('Updated .env file');

      // Reload the environment variables into process.env
      dotenv.config({ path: envPath, override: true });
      logger.info('Reloaded environment variables');
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error updating configuration', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

export default router;