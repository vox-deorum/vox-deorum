/**
 * @module utils/models/models
 *
 * LLM model instance management utilities.
 * Handles creation and configuration of language models from various providers with middleware support.
 */

import { type EmbeddingModel, LanguageModel, ProviderMetadata, extractReasoningMiddleware, wrapLanguageModel } from 'ai';
import { config } from '../config.js';
import type { Model, ReasoningEffort } from '../../types/index.js';
import { createOpenRouter, LanguageModelV3 } from '@openrouter/ai-sdk-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { hermesToolMiddleware } from '@ai-sdk-tool/parser';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import dotenv from 'dotenv';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { toolRescueMiddleware } from './tool-rescue/middleware.js';
import { buildClaudeCodeModel } from './providers/claude-code.js';
import { claudeCodeSystemMiddleware } from './providers/claude-code-prompt.js';
import { buildCodexModel, buildCodexProviderOptions } from './providers/codex.js';
import { hostCapabilityMiddleware } from './providers/host-capability-prompt.js';
import { requiredToolChoiceMiddleware } from './providers/required-tool-choice.js';
import { isHostCapabilityProvider, resolveHostToolCapabilities } from './providers/host-tools.js';
import type { ModelRuntimeIdentity } from './providers/host-tools.js';
import type { ToolCallFraming } from './tool-rescue/types.js';
import { Agent } from 'undici';
import { createLogger } from '../logger.js';
import { synthesizeModelConfig } from './rules.js';
import { parseModelReference } from './model-reference.js';
import { getRuntimeModel } from './resolution.js';

export type { ModelRuntimeIdentity } from './providers/host-tools.js';
export type { ModelSize } from '../../types/config.js';
export { selectModelReference } from './resolution.js';

dotenv.config();

/** Records synthesized IDs already announced during this process. */
const loggedSynthesizedIds = new Set<string>();

/** Records unknown IDs already warned about during this process. */
const warnedUnknownIds = new Set<string>();

/** Model-resolution diagnostics without configuration values or credentials. */
const modelsLogger = createLogger('models');

/** Applies the caller's reasoning override to an explicit or synthesized model configuration. */
function applyReasoning(model: Model, reasoning?: ReasoningEffort | 'default'): Model {
  if (!reasoning || (reasoning === 'default' && model.options?.reasoningEffort)) return model;
  return {
    ...model,
    options: { ...model.options, reasoningEffort: reasoning === 'default' ? 'medium' : reasoning },
  };
}

/**
 * Get a LLM model config by name.
 * Supports model aliasing, reasoning effort configuration, and config overrides.
 *
 * @param name - Name of the model configuration (default: "default")
 * @param reasoning - Optional reasoning effort level for reasoning models
 * @param overrides - Optional model configuration overrides to replace config.json definitions
 * @returns Model configuration object
 *
 * @example
 * ```typescript
 * const model = getModelConfig('default', 'high');
 * const model = getModelConfig('default', undefined, { 'default': { provider: 'openai', name: 'gpt-4' } });
 * ```
 */
export function getModelConfig(
  name: string = 'default',
  reasoning?: ReasoningEffort | 'default',
  overrides?: Record<string, Model | string>
): Model {
  // Check overrides first
  if (overrides && overrides[name]) {
    const override = overrides[name];
    if (typeof override === 'string') {
      return getModelConfig(override, reasoning, overrides);
    }
    return applyReasoning(override, reasoning);
  }

  // Fall back to config.llms
  const model = config.llms[name];
  if (!model) {
    if (name === "default") throw new Error("The assignment for `default` is not found. Please check your settings!")
    const parsed = parseModelReference(name);
    const suffixReasoning = parsed.reasoningEffort;
    if (parsed.fullKey !== name) {
      const resolved = getModelConfig(parsed.fullKey, suffixReasoning, overrides);
      return applyReasoning(resolved, reasoning);
    }
    const verified = getRuntimeModel(name);
    if (verified) return applyReasoning(verified, reasoning);
    const synthesized = synthesizeModelConfig(name);
    if (synthesized) {
      if (!loggedSynthesizedIds.has(name)) {
        loggedSynthesizedIds.add(name);
        modelsLogger.info(`Synthesized model configuration for '${name}'.`);
      }
      return applyReasoning(synthesized, reasoning);
    }
    if (!warnedUnknownIds.has(name)) {
      warnedUnknownIds.add(name);
      modelsLogger.warn(`Unknown model configuration '${name}', falling back to 'default'.`);
    }
    return getModelConfig("default", reasoning, overrides);
  }
  if (typeof(model) === "string") {
    return getModelConfig(model, reasoning, overrides);
  } else return applyReasoning(model, reasoning);
}


/**
 * Resolves the tool-call terminology preset for a model. claude-code always uses 'action'
 * framing: its CLI persona reasons in terms of actions, and keeping the terminology uniform
 * across every claude-code turn (whether or not built-in CLI tools are enabled) also avoids
 * the JSON-invoked game tools and the CLI's native tools both reading as "tools". Every other
 * model uses the default 'tool'. An explicit options.framing override wins (Oracle replay).
 * Exported so callers outside getModel (e.g. the empty-response rescue prompt in vox-agent)
 * can match the model's framing.
 */
export function resolveToolFraming(config: Model): ToolCallFraming {
  // Explicit override wins: Oracle replay sets this to reproduce the original turn's
  // framing on any replay model, regardless of provider.
  if (config.options?.framing) return config.options.framing;
  return config.provider === 'claude-code' ? 'action' : 'tool';
}

/**
 * Get a LLM model instance by name.
 * Creates a language model from the specified provider and wraps it with
 * appropriate middleware (gemmaToolMiddleware for Gemma models, toolRescueMiddleware for others).
 *
 * @param config - Model configuration object
 * @param options - Additional options for model configuration
 * @returns Wrapped LanguageModel instance ready for use
 * @throws Error if the provider is not supported
 *
 * @example
 * ```typescript
 * const modelConfig = getModelConfig('default');
 * const model = getModel(modelConfig);
 * // Or, for claude-code with built-in CLI tools, keyed to a temp working dir:
 * const model = getModel(modelConfig, { workingDirId: `${gameID}-${playerID}` });
 * ```
 */
export function getModel(config: Model, options?: {
  workingDirId?: string;
  onToolFraming?: (info: { framing: ToolCallFraming }) => void;
  /** The calling agent's completion tools, named by provider prompt guidance. */
  completionTools?: string[];
}): LanguageModel {
  let result: LanguageModelV3;
  // Terminology preset for the prompt-mode tool instructions (see resolveToolFraming):
  // 'action' for claude-code, 'tool' for everything else.
  const toolFraming: ToolCallFraming = resolveToolFraming(config);
  // Find providers
  switch (config.provider) {
    case "openrouter":
      result = createOpenRouter()(config.name);
      break;
    case "chutes":
      result = createOpenAICompatible({
        baseURL: "https://llm.chutes.ai/v1",
        name: "chutes",
        apiKey: process.env.CHUTES_API_KEY
      }).chatModel(config.name);
      break;
    case "synthetic":
      result = createOpenAICompatible({
        baseURL: "https://api.synthetic.new/openai/v1",
        name: "synthetic",
        apiKey: process.env.SYNTHETIC_API_KEY,
        fetch: (url, options) => {
          return fetch(url, {
            ...options,
            dispatcher: new Agent({
              headersTimeout: 600_000,
              bodyTimeout: 600_000,
              connectTimeout: 600_000,
              keepAliveTimeout: 600_000,
            }),
          })
        },
      }).chatModel(config.name);
      break;
    case "openai":
      result = createOpenAI()(config.name);
      break;
    case "google": {
      const isAnthropicModel = config.name.startsWith('claude-');
      const flexHeaders = process.env.USE_FLEX === 'true'
        ? { 'X-Vertex-AI-LLM-Shared-Request-Type': 'flex' } : undefined;
      if (isAnthropicModel) {
        const provider = createVertexAnthropic({
          headers: flexHeaders,
          googleAuthOptions: { apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY } }
        );
        // Claude on Vertex shares Anthropic's required-tool-choice rejection.
        result = wrapLanguageModel({
          model: provider(config.name),
          middleware: requiredToolChoiceMiddleware({ completionTools: options?.completionTools })
        });
      } else {
        const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';
        result = useVertex
          ? createVertex({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY, headers: flexHeaders })(config.name)
          : createGoogleGenerativeAI({ headers: flexHeaders })(config.name);
      }
      break;
    }
    case "anthropic":
      // Anthropic rejects a wire-level required tool choice; the middleware maps it to auto and
      // restates the requirement in the system prompt, naming the agent's completion tools as the
      // ones that end the turn so a support call cannot read as a way to finish.
      result = wrapLanguageModel({
        model: createAnthropic()(config.name),
        middleware: requiredToolChoiceMiddleware({ completionTools: options?.completionTools })
      });
      break;
    case "claude-code": {
      // The provider builder rebinds configuration to forced prompt mode. The
      // middleware tail below must use that rebound value to preserve tool behavior.
      const claudeCode = buildClaudeCodeModel(config, options);
      result = claudeCode.model;
      config = claudeCode.config;
      break;
    }
    case "codex":
      result = buildCodexModel(config, { completionTools: options?.completionTools });
      break;
    case "aws":
      result = createAmazonBedrock()(config.name);
      break;
    default:
      if (!process.env.OPENAI_COMPATIBLE_URL)
        throw new Error("Didn't find the OPENAI_COMPATIBLE_URL in environment variables! Please check your settings.");
      result = createOpenAICompatible({
        baseURL: process.env.OPENAI_COMPATIBLE_URL,
        name: config.provider,
        apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
        fetch: (url, options) => {
          return fetch(url, {
            ...options,
            dispatcher: new Agent({
              headersTimeout: 180_000,
              bodyTimeout: 180_000,
              connectTimeout: 180_000,
              keepAliveTimeout: 600_000,
            }),
          })
        },
      }).chatModel((process.env.OPENAI_COMPATIBLE_URL.indexOf("cloudflare.com") !== -1 ? "dynamic/" : "") + config.name);
      break;
  }
  // Wrap with reasoning extraction middleware for models that emit <think> tags
  if (config.options?.thinkMiddleware) {
    result = wrapLanguageModel({
      model: result,
      middleware: extractReasoningMiddleware({ tagName: config.options.thinkMiddleware })
    });
  }
  // For claude-code, normalize the prompt's system messages BEFORE they reach the provider, which
  // otherwise keeps only the LAST system message and drops the rest (main prompt, game situation,
  // and the tool-rescue-injected schema block). Wrapped here so it lands INNER to the tool
  // middleware below (AI-SDK middleware transformParams runs outermost-first), letting it run AFTER
  // tool-rescue injects its instructions so the merged leading system message carries the schemas.
  if (config.provider === 'claude-code') {
    result = wrapLanguageModel({
      model: result,
      middleware: claudeCodeSystemMiddleware()
    });
  }
  // Wrap it for tool calling
  switch (config.options?.toolMiddleware) {
    case "gemma":
      result = wrapLanguageModel({
        model: result,
        middleware: hermesToolMiddleware
      });
      break;
    case "prompt":
      result = wrapLanguageModel({
        model: result,
        middleware: toolRescueMiddleware({ prompt: true, systemPromptFirst: config.options?.systemPromptFirst, framing: toolFraming, onToolFraming: options?.onToolFraming, structuredToolCalls: config.provider === 'claude-code' })
      });
      break;
    default:
      result = wrapLanguageModel({
        model: result,
        middleware: toolRescueMiddleware()
      });
  }
  // Host-capability guidance is deliberately outermost. It runs before tool
  // rescue, Claude system-message normalization, and required-tool handling so
  // each inner middleware sees the reminder in the prompt it transforms.
  const requestedHostTools = config.options?.hostTools;
  if (isHostCapabilityProvider(config.provider) && requestedHostTools?.length) {
    result = wrapLanguageModel({
      model: result,
      middleware: hostCapabilityMiddleware(
        config.provider,
        resolveHostToolCapabilities(requestedHostTools),
        options?.completionTools,
      ),
    });
  }
  return result;
}

/**
 * Build provider options from model configuration
 *
 * Converts OpenAI-style reasoningEffort to OpenRouter's reasoning.effort format
 * when using the openrouter provider.
 *
 * @param model - The model configuration
 * @returns Provider options object keyed by provider name
 *
 * @example
 * // OpenAI format
 * buildProviderOptions({
 *   provider: 'openai',
 *   name: 'gpt-5',
 *   options: { reasoningEffort: 'high' }
 * })
 * // Returns: { openai: { reasoningEffort: 'high' } }
 *
 * @example
 * // OpenRouter conversion
 * buildProviderOptions({
 *   provider: 'openrouter',
 *   name: 'deepseek/deepseek-r1',
 *   options: { reasoningEffort: 'medium' }
 * })
 * // Returns: { openrouter: { reasoning: { effort: 'medium' } } }
 */
export function buildProviderOptions(model: Model, runtimeIdentity?: ModelRuntimeIdentity): ProviderMetadata {
  // Model-name defaults are assigned by rules.ts; request-time reasoning and provider
  // translation intentionally remain here where the adapters serialize them.
  let result: ProviderMetadata;

  const isVertexAnthropic = model.provider === 'google' && model.name.startsWith('claude-');
  const providerOptionsKey = isVertexAnthropic ? 'anthropic' : model.provider;

  // Claude Code applies every configuration setting at construction time.
  if (model.provider === 'claude-code') {
    result = {};
  }

  // Codex permits only its compatible adapter fields and proxy extension.
  else if (model.provider === 'codex') {
    result = buildCodexProviderOptions(model, runtimeIdentity);
  }

  else if (!model.options) {
    result = { [providerOptionsKey]: {} };
  }

  // Handle OpenRouter's reasoning format
  else if (model.provider === 'openrouter' && model.options.reasoningEffort) {
    const { reasoningEffort, ...otherOptions } = model.options;
    result = {
      openrouter: {
        ...otherOptions,
        reasoning: {
          effort: reasoningEffort
        }
      }
    };
  }

  // Handle Gemma's thinking format
  else if (model.provider === 'openai-compatible' && model.options.reasoningEffort && model.options.reasoningEffort !== "minimal" && model.name.toLowerCase().includes('gemma-4')) {
    result = {
      openaiCompatible: {
        ...model.options,
        extra_body: { chat_template_kwargs: { enable_thinking: true } },
        allowed_openai_params: ['reasoning_effort']
      }
    };
  }

  // Handle LiteLLM's reasoning format
  else if (model.provider === 'openai-compatible' && model.options.reasoningEffort) {
    result = {
      openaiCompatible: {
        ...model.options,
        allowed_openai_params: ['reasoning_effort']
      }
    };
  }

  // Handle Anthropic's reasoning format (direct Anthropic or Claude on Vertex)
  else if ((model.provider === 'anthropic' || (model.provider === 'google' && model.name.startsWith('claude-'))) && model.options.reasoningEffort) {
    const { reasoningEffort, ...otherOptions } = model.options;
    if (reasoningEffort === 'minimal') {
      // minimal maps to no thinking — pass through without effort
      result = {
        anthropic: {
          ...otherOptions,
          thinking: { type: 'disabled' },
        }
      };
    } else {
      result = {
        anthropic: {
          ...otherOptions,
          thinking: { type: 'adaptive', display: 'summarized' },
          effort: reasoningEffort
        }
      };
    }
  }

  // Handle Google/Vertex's thinking format
  else if (model.provider === 'google' && model.options.reasoningEffort) {
    const { reasoningEffort, ...otherOptions } = model.options;
    const providerKey = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ? 'vertex' : 'google';
    result = {
      [providerKey]: {
        ...otherOptions,
        thinkingConfig: {
          thinkingLevel: reasoningEffort === 'minimal' ? 'low' : reasoningEffort,
          includeThoughts: true,
        },
      }
    };
  }

  // Default: pass options through as-is
  else {
    result = {
      [providerOptionsKey]: model.options
    };
  }

  return result;
}

/**
 * Get an embedding model instance from a model configuration.
 * The config should have `options.embeddingSize` set to mark it as an embedding model.
 *
 * @param config - Model configuration object (same LLMConfig type as chat models)
 * @returns EmbeddingModel instance from the AI SDK
 * @throws Error if the provider doesn't support embedding models
 */
export function getEmbeddingModel(config: Model): EmbeddingModel {
  switch (config.provider) {
    case "openai":
      return createOpenAI().textEmbeddingModel(config.name);
    case "google":
      return (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true'
        ? createVertex({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
        : createGoogleGenerativeAI()
      ).textEmbeddingModel(config.name);
    case "openai-compatible": {
      if (!process.env.OPENAI_COMPATIBLE_URL)
        throw new Error("OPENAI_COMPATIBLE_URL not set for embedding model");
      return createOpenAICompatible({
        baseURL: process.env.OPENAI_COMPATIBLE_URL,
        name: config.provider,
        apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
      }).textEmbeddingModel(config.name);
    }
    default:
      throw new Error(`Embedding provider '${config.provider}' is not supported. Use openai, google, or openai-compatible.`);
  }
}
