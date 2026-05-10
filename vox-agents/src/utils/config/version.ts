/**
 * @module utils/config/version
 *
 * Resolve the running build's version triple from `version.json` plus
 * the current short git commit hash. Used at startup for logs and as
 * the MCP client identifier.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createLogger } from '../logger.js';
import type { VersionInfo } from '../../types/index.js';

const logger = createLogger('Config');

/**
 * Load version information from version.json and git.
 * Combines major.minor.revision from version.json with git commit hash.
 *
 * @returns Version information object or undefined if loading fails
 */
export function loadVersionInfo(): VersionInfo | undefined {
  try {
    // Load version.json from project root
    const versionPath = path.join(process.cwd(), '..', 'version.json');
    if (!fs.existsSync(versionPath)) {
      logger.warn('version.json not found');
      return undefined;
    }

    const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
    const { major = 0, minor = 0, revision = 0 } = versionData;

    // Try to get git commit hash
    let commit: string | undefined;
    try {
      commit = execSync('git rev-parse --short HEAD', {
        encoding: 'utf-8',
        cwd: path.join(process.cwd(), '..')
      }).trim();
    } catch (error) {
      logger.debug('Failed to get git commit hash:', error);
    }

    // Build version string
    const versionString = commit
      ? `${major}.${minor}.${revision} (${commit})`
      : `${major}.${minor}.${revision}`;

    return {
      version: versionString,
      major,
      minor,
      revision,
      commit
    };
  } catch (error) {
    logger.warn('Failed to load version info:', error instanceof Error ? error.message : 'Unknown error');
    return undefined;
  }
}
