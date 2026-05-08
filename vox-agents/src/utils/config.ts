/**
 * @module utils/config
 *
 * Configuration loader for Vox Agents.
 * Handles loading configuration from JSON files and environment variables,
 * with support for version information from git and version.json.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import { createLogger } from './logger.js';
import type { VoxAgentsConfig, TransportType, VersionInfo, LLMConfig } from '../types/index.js';

const logger = createLogger('Config');

/**
 * Default configuration values
 */
export const defaultConfig: VoxAgentsConfig = {
  agent: {
    name: 'vox-agents'
  },
  webui: {
    port: 5555,
    enabled: true
  },
  mcpServer: {
    transport: {
      type: 'http',
      endpoint: 'http://127.0.0.1:4000/mcp'
    }
  },
  logging: {
    level: 'info'
  },
  llms: {
    default: 'openai-compatible/gpt-oss-120b',
    'openai/gpt-5.4': {
      provider: 'openai',
      name: 'gpt-5.4'
    },
    'openai/gpt-5.4-mini': {
      provider: 'openai',
      name: 'gpt-5.4-mini'
    },
    'openai/gpt-5.4-nano': {
      provider: 'openai',
      name: 'gpt-5.4-nano'
    },
    'google/Gemma-4-26B': {
      provider: 'google',
      name: 'gemma-4-26b-a4b-it'
    },
    'google/Gemini-3.1-Pro': {
      provider: 'google',
      name: 'gemini-3.1-pro-preview'
    },
    'google/Gemini-3.1-Flash-Lite': {
      provider: 'google',
      name: 'gemini-3.1-flash-lite-preview'
    },
    'openrouter/openai/gpt-oss-120b': {
      provider: 'openrouter',
      name: 'openai/gpt-oss-120b',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openrouter/google/gemma3-27b': {
      provider: 'openrouter',
      name: 'google/gemma-3-27b-it',
      options: {
        toolMiddleware: 'gemma'
      }
    },
    'anthropic/claude-haiku-4-5': {
      provider: 'anthropic',
      name: 'claude-haiku-4-5'
    },
    'anthropic/claude-sonnet-4-6': {
      provider: 'anthropic',
      name: 'claude-sonnet-4-6'
    },
    'anthropic/claude-opus-4-7': {
      provider: 'anthropic',
      name: 'claude-opus-4-7'
    },
    'synthetic/hf:moonshotai/Kimi-K2.5': {
      provider: 'synthetic',
      name: 'hf:moonshotai/Kimi-K2.5',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'synthetic/hf:MiniMaxAI/MiniMax-M2.7': {
      provider: 'synthetic',
      name: 'hf:MiniMaxAI/MiniMax-M2.7',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/gpt-oss-120b': {
      provider: 'openai-compatible',
      name: 'gpt-oss-120b',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/GLM-4.7': {
      provider: 'openai-compatible',
      name: 'GLM-4.7',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/GLM-5.1': {
      provider: 'openai-compatible',
      name: 'GLM-5.1'
    },
    'openai-compatible/Qwen-3.5': {
      provider: 'openai-compatible',
      name: 'Qwen-3.5',
      options: {
        systemPromptFirst: true,
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/Qwen-3.6-35B': {
      provider: 'openai-compatible',
      name: 'Qwen-3.6-35B',
      options: {
        systemPromptFirst: true,
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/Qwen-3.6-27B': {
      provider: 'openai-compatible',
      name: 'Qwen-3.6-27B',
      options: {
        systemPromptFirst: true,
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/DeepSeek-V3.2': {
      provider: 'openai-compatible',
      name: 'DeepSeek-V3.2',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/DeepSeek-V4': {
      provider: 'openai-compatible',
      name: 'DeepSeek-V4'
    },
    'openai-compatible/Kimi-K2-Thinking': {
      provider: 'openai-compatible',
      name: 'Kimi-K2-Thinking',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/Kimi-K2.5': {
      provider: 'openai-compatible',
      name: 'Kimi-K2.5',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/claude-opus-4-7': {
      provider: 'anthropic',
      name: 'claude-opus-4-7',
      options: {
        concurrencyLimit: 1
      }
    },
    'openai-compatible/Kimi-K2.6': {
      provider: 'openai-compatible',
      name: 'Kimi-K2.6',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/Minimax-M2.5': {
      provider: 'openai-compatible',
      name: 'Minimax-M2.5',
      options: {
        toolMiddleware: 'prompt',
        thinkMiddleware: 'think'
      }
    },
    'openai-compatible/Minimax-M2.7': {
      provider: 'openai-compatible',
      name: 'Minimax-M2.7',
      options: {
        toolMiddleware: 'prompt',
        thinkMiddleware: 'think'
      }
    },
    'openai-compatible/Nemotron-3-Super': {
      provider: 'openai-compatible',
      name: 'Nemotron-3-Super',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/Gemma-4': {
      provider: 'openai-compatible',
      name: 'Gemma-4',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/mistral-small-4': {
      provider: 'openai-compatible',
      name: 'mistral-small-4'
    },
    'openai-compatible/embedder': {
      provider: 'openai-compatible',
      name: 'embedder',
      options: { embeddingSize: 4096 }
    },
    'embedder': 'openai-compatible/embedder',
  },
  configsDir: 'configs',
  episodeDbPath: 'episodes.duckdb',
  telemetryDir: '',
  obs: {
    wsPort: 4455
  }
};

/**
 * Recursive deep equality check for plain JSON values
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => key in bObj && deepEqual(aObj[key], bObj[key]));
}

/**
 * Strip the `id` field from an LLM config value (UI adds it, defaults don't have it)
 */
function stripLLMId(val: string | LLMConfig | null): string | Omit<LLMConfig, 'id'> | null {
  if (typeof val !== 'object' || val === null) return val;
  const { id, ...rest } = val;
  return rest;
}

/**
 * Compute the minimal diff between a full config and defaults.
 * Only entries that differ from defaults are included.
 * For llms, deleted default entries are marked with null.
 */
export function computeConfigDiff(
  fullConfig: VoxAgentsConfig,
  defaults: VoxAgentsConfig
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};

  // Compare simple top-level fields (skip versionInfo - runtime only)
  const topLevelKeys: (keyof VoxAgentsConfig)[] = ['agent', 'webui', 'mcpServer', 'logging', 'configsDir', 'episodeDbPath', 'telemetryDir', 'obs'];
  for (const key of topLevelKeys) {
    if (!deepEqual(fullConfig[key], defaults[key])) {
      diff[key] = fullConfig[key];
    }
  }

  // Entry-level diff for llms
  const llmsDiff: Record<string, string | LLMConfig | null> = {};

  // Find modified/added entries
  for (const [key, value] of Object.entries(fullConfig.llms)) {
    const defaultValue = defaults.llms[key];
    if (defaultValue === undefined) {
      // User-added entry
      llmsDiff[key] = stripLLMId(value) as string | LLMConfig;
    } else if (!deepEqual(stripLLMId(value), stripLLMId(defaultValue))) {
      // Modified entry
      llmsDiff[key] = stripLLMId(value) as string | LLMConfig;
    }
  }

  // Find deleted default entries
  for (const key of Object.keys(defaults.llms)) {
    if (!(key in fullConfig.llms)) {
      llmsDiff[key] = null;
    }
  }

  if (Object.keys(llmsDiff).length > 0) {
    diff.llms = llmsDiff;
  }

  return diff;
}

/**
 * Reconstruct a full config by merging a diff file with defaults.
 * Handles null sentinels in llms as deletions.
 */
export function mergeConfigWithDefaults(
  fileConfig: Record<string, unknown>,
  defaults: VoxAgentsConfig
): VoxAgentsConfig {
  // Start with a shallow clone of defaults, deep clone llms separately
  const result: VoxAgentsConfig = {
    ...defaults,
    llms: { ...defaults.llms }
  };

  // Override top-level fields from file (skip llms, handled separately)
  const topLevelKeys: (keyof VoxAgentsConfig)[] = ['agent', 'webui', 'mcpServer', 'logging', 'configsDir', 'episodeDbPath', 'telemetryDir', 'obs'];
  for (const key of topLevelKeys) {
    if (key in fileConfig) {
      (result as any)[key] = fileConfig[key];
    }
  }

  // Merge llms with null-deletion support
  if (fileConfig.llms && typeof fileConfig.llms === 'object') {
    const fileLlms = fileConfig.llms as Record<string, string | LLMConfig | null>;
    for (const [key, value] of Object.entries(fileLlms)) {
      if (value === null) {
        delete result.llms[key];
      } else {
        result.llms[key] = value;
      }
    }
  }

  return result;
}

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