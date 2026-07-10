/**
 * @module utils/config/defaults
 *
 * Default `VoxAgentsConfig` shipped with the codebase.
 * The bulk of this module is the LLM model registry (`llms`), which
 * `config.json` overrides on a per-entry basis via `mergeConfigWithDefaults`.
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
    'google/Gemini-3.5-Flash': {
      provider: 'google',
      name: 'gemini-3.5-flash'
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
    'claude-code/sonnet': {
      provider: 'claude-code',
      name: 'sonnet',
      // prompt-mode tool calling is forced unconditionally in getModel's
      // 'claude-code' case (no native tool calling), so it is not set here.
      options: {
        concurrencyLimit: 1
      }
    },
    'claude-code/opus': {
      provider: 'claude-code',
      name: 'opus',
      options: {
        concurrencyLimit: 1
      }
    },
    'claude-code/haiku': {
      provider: 'claude-code',
      name: 'haiku',
      options: {
        concurrencyLimit: 1
      }
    },
    'synthetic/hf:moonshotai/Kimi-K2.6': {
      provider: 'synthetic',
      name: 'hf:moonshotai/Kimi-K2.6',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'synthetic/hf:MiniMaxAI/MiniMax-M3': {
      provider: 'synthetic',
      name: 'hf:MiniMaxAI/MiniMax-M3',
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
    'openai-compatible/GLM-5.2': {
      provider: 'openai-compatible',
      name: 'GLM-5.2',
      options: {
        toolMiddleware: 'prompt'
      }
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
    'openai-compatible/Kimi-K2.5': {
      provider: 'openai-compatible',
      name: 'Kimi-K2.5',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/Kimi-K2.6': {
      provider: 'openai-compatible',
      name: 'Kimi-K2.6',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/Kimi-K2.7': {
      provider: 'openai-compatible',
      name: 'Kimi-K2.7',
      options: {
        toolMiddleware: 'prompt'
      }
    },
    'openai-compatible/MiniMax-M2.7': {
      provider: 'openai-compatible',
      name: 'MiniMax-M2.7',
      options: {
        toolMiddleware: 'prompt',
        thinkMiddleware: 'think'
      }
    },
    'openai-compatible/MiniMax-M3': {
      provider: 'openai-compatible',
      name: 'MiniMax-M3',
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
