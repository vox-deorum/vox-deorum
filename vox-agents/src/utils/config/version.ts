/**
 * @module utils/config/version
 *
 * Resolve the running build's version triple from `version.json` plus
 * the current short git commit hash when available. Used at startup for logs and as
 * the MCP client identifier.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createLogger } from '../logger.js';
import { errorMessage } from '../errors.js';
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
    const projectRoot = path.resolve(process.cwd(), '..');
    const versionPath = path.join(projectRoot, 'version.json');
    if (!fs.existsSync(versionPath)) {
      logger.warn('version.json not found');
      return undefined;
    }

    const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
    const { major = 0, minor = 0, revision = 0 } = versionData;

    // Installed builds have no Git metadata; worktrees use a .git file.
    let commit: string | undefined;
    if (fs.existsSync(path.join(projectRoot, '.git'))) {
      try {
        commit = execSync('git rev-parse --short HEAD', {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          cwd: projectRoot
        }).trim();
      } catch {
        // Git is optional; installed builds can use the version number alone.
      }
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
    logger.warn('Failed to load version info:', errorMessage(error, 'Unknown error'));
    return undefined;
  }
}
