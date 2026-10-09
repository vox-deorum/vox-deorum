/**
 * @module utils/config/defaults
 *
 * Default `VoxAgentsConfig` shipped with the codebase.
 * `config.json` overrides individual values, including the small default LLM
 * registry, through `mergeConfigWithDefaults`.
 */

import type { VoxAgentsConfig } from '../../types/index.js';

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
    'openai-compatible/gpt-oss-120b': {
      provider: 'openai-compatible',
      name: 'gpt-oss-120b',
      options: { toolMiddleware: 'prompt' }
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
  },
  useDX11: true,
  prompts: false
};
