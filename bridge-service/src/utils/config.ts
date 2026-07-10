/**
 * Configuration Utility
 *
 * @module bridge-service/utils/config
 *
 * @description
 * Configuration loader for the Bridge Service. Loads configuration from:
 * 1. config.json file (if exists)
 * 2. Environment variables (override file settings)
 * 3. Default values (fallback)
 *
 * Configuration precedence: Environment Variables > config.json > Defaults
 *
 * @example
 * ```typescript
 * import { config } from './utils/config.js';
 *
 * console.log('REST port:', config.rest.port);
 * console.log('DLL pipe:', config.gamepipe.id);
 * ```
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from './logger.js';

/**
 * Service configuration structure
 *
 * @interface ServiceConfig
 *
 * @description
 * Complete configuration structure for the Bridge Service.
 *
 * @property rest - REST API server configuration
 * @property rest.port - HTTP server port
 * @property rest.host - HTTP server bind address
 * @property gamepipe - DLL IPC connection configuration
 * @property gamepipe.id - Named pipe identifier for DLL connection
 * @property eventpipe - Event broadcasting configuration
 * @property eventpipe.enabled - Whether event pipe is enabled
 * @property eventpipe.name - Named pipe identifier for event broadcasting
 * @property logging - Logging configuration
 * @property logging.level - Log level (error, warn, info, debug)
 */
export interface ServiceConfig {
  rest: {
    port: number;
    host: string;
  };
  gamepipe: {
    id: string;
  };
  eventpipe: {
    enabled: boolean;
    name: string;
  };
  logging: {
    level: string;
  };
}

const logger = createLogger('Config');

/**
 * Default configuration values
 */
const defaultConfig: ServiceConfig = {
  rest: {
    port: 5000,
    host: '127.0.0.1'
  },
  gamepipe: {
    id: 'vox-deorum-bridge'
  },
  eventpipe: {
    enabled: false,
    name: 'vox-deorum-events'
  },
  logging: {
    level: 'info'
  }
};

/**
 * Load configuration from file and environment variables
 *
 * @function loadConfig
 *
 * @description
 * Loads and merges configuration from multiple sources with proper precedence.
 * The configuration is loaded once at startup and cached.
 *
 * @returns Complete service configuration object
 *
 * @example
 * ```typescript
 * const config = loadConfig();
 * // Use config.rest.port, config.gamepipe.id, etc.
 * ```
 */
export function loadConfig(): ServiceConfig {
  const configPath = path.join(process.cwd(), 'config.json');
  let fileConfig: Partial<ServiceConfig> = {};
  const eventPipeEnabledOverride = process.env.EVENTPIPE_ENABLED === undefined
    ? undefined
    : process.env.EVENTPIPE_ENABLED === 'true';

  // Load from config file if exists
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(configContent);
      logger.info('Configuration loaded from config.json');
    } catch (error) {
      logger.error('Failed to load config.json:', error);
    }
  }

  // Build final configuration with environment variable overrides
  const config: ServiceConfig = {
    rest: {
      port: parseInt(process.env.PORT || '') || fileConfig.rest?.port || defaultConfig.rest.port,
      host: process.env.HOST || fileConfig.rest?.host || defaultConfig.rest.host
    },
    gamepipe: {
      id: process.env.gamepipe_ID || fileConfig.gamepipe?.id || defaultConfig.gamepipe.id
    },
    eventpipe: {
      enabled: eventPipeEnabledOverride ?? fileConfig.eventpipe?.enabled ?? defaultConfig.eventpipe.enabled,
      name: process.env.EVENTPIPE_NAME || fileConfig.eventpipe?.name || defaultConfig.eventpipe.name
    },
    logging: {
      level: process.env.LOG_LEVEL || fileConfig.logging?.level || defaultConfig.logging.level
    }
  };

  // Update logger level based on configuration
  logger.level = config.logging.level;

  logger.info('Configuration loaded:', {
    rest: config.rest,
    gamepipe: { id: config.gamepipe.id },
    eventpipe: config.eventpipe,
    logging: { level: config.logging.level }
  });

  return config;
}

/**
 * Singleton configuration instance
 */
export const config = loadConfig();

export default config;
