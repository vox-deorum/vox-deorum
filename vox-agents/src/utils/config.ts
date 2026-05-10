/**
 * @module utils/config
 *
 * Configuration entry point. Owns the loaded singleton, the file/env
 * loaders, and the configs-directory resolver. Defaults, diff/merge
 * helpers, and version-info loading live in `./config/`.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createLogger } from './logger.js';
import type { VoxAgentsConfig, TransportType } from '../types/index.js';
import { defaultConfig } from './config/defaults.js';
import { mergeConfigWithDefaults } from './config/diff.js';
import { loadVersionInfo } from './config/version.js';

const logger = createLogger('Config');

/**
 * Load VoxAgentsConfig from a JSON file, deep-merging with defaults.
 * Handles both old full configs and new diff-only configs.
 */
export function loadVoxConfig(filename: string): VoxAgentsConfig {
  const configPath = path.isAbsolute(filename)
    ? filename
    : path.join(process.cwd(), filename);

  let fileConfig: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      logger.info(`Loaded configuration from ${filename}`);
    } catch (error) {
      logger.warn(`Failed to load ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else {
    logger.info(`No ${filename} found, using default configuration`);
  }

  return mergeConfigWithDefaults(fileConfig, defaultConfig);
}

/**
 * Load configuration from a JSON file with fallback to defaults
 * @param filename - Name of the config file to load
 * @param defaultConfig - Default configuration object
 * @param overrides - Optional overrides to apply after loading
 * @returns Merged configuration object
 */
export function loadConfigFromFile<T extends object>(
  filename: string,
  defaultConfig: T,
  overrides?: Partial<T>
): T {
  const configPath = path.isAbsolute(filename)
    ? filename
    : path.join(process.cwd(), filename);

  let fileConfig: Partial<T> = {};

  if (fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(fileContent) as Partial<T>;
      logger.info(`Loaded configuration from ${filename}`);
    } catch (error) {
      logger.warn(`Failed to load ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.info('Using default configuration');
    }
  } else {
    logger.info(`No ${filename} found, using default configuration`);
  }

  // Merge in order: defaults -> file config -> overrides
  return { ...defaultConfig, ...fileConfig, ...(overrides || {}) };
}

/**
 * Load configuration from file and environment variables.
 * Environment variables override file configuration values.
 * Supports both file-based and environment-based transport configuration.
 *
 * @returns Complete configuration object with all settings merged
 */
function loadConfig(): VoxAgentsConfig {
  dotenv.config();

  // Load base config from file (deep-merges with defaults)
  const fileConfig = loadVoxConfig('config.json');

  // Parse transport type from environment
  const transportType = (process.env.MCP_TRANSPORT as TransportType) ||
    fileConfig.mcpServer.transport.type;

  // Load version info
  const versionInfo = loadVersionInfo();

  // Build final configuration with environment variable overrides
  const config: VoxAgentsConfig = {
    agent: {
      name: process.env.AGENT_NAME || fileConfig.agent.name,
    },
    versionInfo,
    webui: {
      port: process.env.WEBUI_PORT ? parseInt(process.env.WEBUI_PORT) : fileConfig.webui.port,
      enabled: process.env.WEBUI_ENABLED ? process.env.WEBUI_ENABLED === 'true' : fileConfig.webui.enabled
    },
    mcpServer: {
      transport: {
        type: transportType,
        endpoint: process.env.MCP_ENDPOINT || fileConfig.mcpServer.transport.endpoint,
        command: process.env.MCP_COMMAND || fileConfig.mcpServer.transport.command,
        args: process.env.MCP_ARGS?.split(' ') || fileConfig.mcpServer.transport.args
      }
    },
    logging: {
      level: process.env.LOG_LEVEL || fileConfig.logging.level
    },
    llms: fileConfig.llms,
    configsDir: process.env.CONFIGS_DIR || fileConfig.configsDir,
    episodeDbPath: process.env.EPISODE_DB_PATH || fileConfig.episodeDbPath,
    telemetryDir: process.env.TELEMETRY_DIR || fileConfig.telemetryDir,
    obs: {
      ...fileConfig.obs,
      ...(process.env.OBS_EXECUTABLE_PATH && { executablePath: process.env.OBS_EXECUTABLE_PATH }),
      ...(process.env.OBS_WS_PORT && { wsPort: parseInt(process.env.OBS_WS_PORT) }),
      ...(process.env.OBS_WS_PASSWORD && { wsPassword: process.env.OBS_WS_PASSWORD }),
    }
  };

  // Update logger level based on configuration
  logger.level = config.logging.level;

  logger.info('Configuration loaded:', {
    agent: config.agent,
    version: versionInfo?.version || 'unknown',
    mcpServer: config.mcpServer,
    logging: { level: config.logging.level }
  });

  return config;
}

/**
 * Singleton configuration instance.
 * Loaded once at module initialization and reused throughout the application.
 *
 * @example
 * ```typescript
 * import { config } from './utils/config.js';
 * console.log(config.agent.name); // 'vox-agents'
 * ```
 */
export let config = loadConfig();

/**
 * Refresh the configuration by reloading from config.json and environment variables.
 * Updates the singleton instance with fresh values by mutating the existing object
 * to preserve references held by other modules.
 *
 * @returns The refreshed configuration object
 */
export function refreshConfig(): VoxAgentsConfig {
  logger.info('Refreshing configuration...');
  const newConfig = loadConfig();

  // Clear existing properties (except those we're about to replace)
  for (const key in config) {
    if (config.hasOwnProperty(key)) {
      delete (config as any)[key];
    }
  }

  // Copy all properties from new config to existing config object
  // This preserves the object reference while updating its contents
  Object.assign(config, newConfig);

  return config;
}

/**
 * Get the absolute path to the configs directory.
 * Uses the CONFIGS_DIR environment variable if set, otherwise defaults to 'configs'.
 * Supports both relative paths (resolved from cwd) and absolute paths.
 *
 * @returns Absolute path to the configs directory
 *
 * @example
 * ```typescript
 * import { getConfigsDir } from './utils/config.js';
 * const configPath = path.join(getConfigsDir(), 'play-simple.json');
 * ```
 */
export function getConfigsDir(): string {
  return path.isAbsolute(config.configsDir)
    ? config.configsDir
    : path.join(process.cwd(), config.configsDir);
}

export default config;
