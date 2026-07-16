/**
 * @module utils/models/concurrency
 *
 * Concurrency-limited streamText wrapper with exponential retry.
 * Provides per-model concurrency limiting to prevent overwhelming API endpoints.
 *
 * When the batch manager is active (for Oracle batch mode), requests for
 * batch-compatible providers are routed through the batch manager instead
 * of being sent as live streaming HTTP calls.
 */

import pLimit from 'p-limit';
import { streamText, TextStreamPart, ToolSet } from 'ai';
import { exponentialRetry } from '../retry.js';
import { createLogger } from '../logger.js';
import type { Model } from '../../types/index.js';
import { VoxContext } from '../../infra/vox-context.js';
import { AgentParameters } from '../../infra/vox-agent.js';
import { hasBatchManager, getBatchManager } from '../../oracle/batch/batch-manager.js';
import { convertToStepResult } from '../../oracle/batch/format-converter.js';
import { takePreservedModelError } from './preserved-model-error.js';

const logger = createLogger('concurrency');

/** Map of model IDs to their p-limit instances */
const modelLimiters = new Map<string, ReturnType<typeof pLimit>>();

/** Monotonic counter to ensure unique chunk IDs across streamText calls */
let streamCallCounter = 0;

/**
 * Get or create a p-limit instance for a specific model.
 * Each model gets its own isolated concurrency limiter.
 *
 * @param model - Model configuration containing provider, name, and optional concurrencyLimit
 * @returns p-limit instance for the model
 */
function getModelLimiter(model: Model): ReturnType<typeof pLimit> {
  // Create a unique ID for the model
  const modelId = `${model.provider}/${model.name}`;

  // Check if we already have a limiter for this model
  let limiter = modelLimiters.get(modelId);

  if (!limiter) {
    // Create a new limiter with the model's concurrency limit (default 5)
    const concurrencyLimit = model.options?.concurrencyLimit ?? 5;
    limiter = pLimit(concurrencyLimit);
    modelLimiters.set(modelId, limiter);
  }

  return limiter;
}

/**
 * Wrapper for streamText that adds per-model concurrency limiting and exponential retry.
 * This is a drop-in replacement for streamText that ensures only a limited number of
 * concurrent requests are made per model. It also properly handles errors that occur
 * during streaming by awaiting the steps Promise within the retry mechanism.
 *
 * @param params - Same parameters as streamText, but model must be a Model object from getModel()
 * @param context - VoxContext
 * @param awaitSteps - Whether to await the steps Promise within the retry (default: true)
 * @returns Promise that resolves to either StreamTextResult or the resolved steps array
 *
 * @example
 * ```typescript
 * // Get the full result with steps awaited
 * const stepResults = await streamTextWithConcurrency({
 *   model: getModel(stepModel),
 *   messages: messages,
 *   // ... other streamText parameters
 * }, context);
 * ```
 */
export async function streamTextWithConcurrency<T extends Parameters<typeof streamText>[0]>(
  params: T & { model: any }, // model is from getModel() which returns LanguageModel
  context: VoxContext<AgentParameters>
) {
  context.timeoutRefresh = () => {};
  // Extract the model config from params
  // The model parameter comes from getModel(stepModel) where stepModel is our Model type
  // We need to get the original Model config to determine concurrency limits
  // This is a bit of a hack but works since we control the call site
  const modelConfig = (params as any).__modelConfig as Model | undefined;

  // Batch mode: route through the batch manager if it's active.
  // This bypasses streaming, per-model concurrency limiting, and retry logic entirely —
  // the batch API handles all of that server-side.
  if (hasBatchManager() && modelConfig) {
    // The batch path serializes params.messages/params.tools directly to the provider's
    // native request; it never invokes the model's tool-rescue middleware. For a prompt-mode
    // model that means native tools would be sent, system prose would not be reworded, and no
    // framing telemetry would be recorded — silently wrong results. Reject the combination
    // rather than replay it incorrectly.
    if (modelConfig.options?.toolMiddleware === 'prompt') {
      throw new Error(
        `Batch mode cannot replay prompt-mode model '${modelConfig.provider}/${modelConfig.name}': ` +
        `the batch path bypasses tool-rescue middleware, so native tools would be sent, system ` +
        `prose would not be reworded to the model's framing, and no framing telemetry would be ` +
        `recorded. Run this experiment without batch mode, or override to a native tool-calling model.`
      );
    }
    const response = await getBatchManager().enqueue(params, modelConfig);
    return convertToStepResult(response);
  }

  // If we don't have the config, use a default limiter
  const limiter = modelConfig
    ? getModelLimiter(modelConfig)
    : pLimit(3); // Default fallback

  // Get model name for logging
  const modelName = modelConfig
    ? `${modelConfig.provider}/${modelConfig.name}`
    : 'unknown-model';

  // Wrap the streamText call with both concurrency limiting and exponential retry
  return limiter(async () => {
    let maxIteration = 0;
    let stopStreaming = () => {};
    let streamController: TransformStreamDefaultController<TextStreamPart<ToolSet>> | undefined;
    let toolCount = 0;

    // Convert system messages after the first non-system message to user messages
    if (modelConfig?.options?.systemPromptFirst && params.messages) {
      params = {
        ...params,
        messages: params.messages.map((msg, i) => {
          if (i !== 0 && msg.role === 'system') return { ...msg, role: 'user' as const };
          return msg;
        })
      };
    }

    // Retry with caveats
    return exponentialRetry(async (update, iteration) => {
      context.timeoutRefresh = () => {
        update();
        toolCount++;
      }
      maxIteration = iteration;
      toolCount = 0;
      
      // Call streamText with all the original parameters
      // Modify onChunk to call the update function for retry timeout reset
      // Also discard late returns if a previous aborted attempt gets resurrected
      const originalOnChunk = params.onChunk;
      const originalOnStepFinish = params.onStepFinish;
      const callId = streamCallCounter++;
      const modifiedParams = {
        ...params,
        allowSystemInMessages: true,
        onChunk: (args: any) => {
          if (maxIteration !== iteration) return;
          // Prefix chunk IDs with call counter to prevent block merging across steps
          const chunk = args.chunk;
          if (chunk?.id) {
            originalOnChunk?.({ chunk: { ...chunk, id: `${callId}-${chunk.id}` } });
          } else {
            originalOnChunk?.(args);
          }
        },
        onStepFinish: (results: any) => {
          if (maxIteration === iteration) originalOnStepFinish?.(results);
        },
        experimental_transform: (options: {
              tools: ToolSet;
              stopStream: () => void;
          }) => {
          stopStreaming = options.stopStream;
          return new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
            transform(chunk, controller) {
              if (maxIteration !== iteration) return;
              streamController = controller;
              controller.enqueue(chunk);
            }
          });
        }
      };
      modifiedParams.providerOptions = modifiedParams.providerOptions ?? {};

      // Consume the raw stream
      const result = streamText(modifiedParams);
      const reader = result.fullStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          update(false);
        }
        update(true);

        // And return the found steps
        const steps = await result.steps;

        // Validate flex tier is effective when enabled
        if (process.env.USE_FLEX === 'true' && modelConfig?.provider === 'google') {
          const lastStep = steps[steps.length - 1];
          const providerMeta = lastStep?.providerMetadata as any;
          const trafficType = providerMeta?.google?.usageMetadata?.trafficType
            ?? providerMeta?.vertex?.usageMetadata?.trafficType;
          if (trafficType !== 'ON_DEMAND_FLEX') {
            logger.warn(`Flex tier not active for ${modelName}: trafficType=${trafficType}`, lastStep?.providerMetadata);
          }
        }

        var response = {
          ...result,
          steps,
        };
        return response;
      } catch (error) {
        // Resurface context length errors that the AI SDK swallowed into AI_NoOutputGeneratedError
        const streamError = takePreservedModelError(modifiedParams);
        if (streamError.found) {
          throw streamError.error;
        }
        throw error;
      }
    }, context.logger, {
      source: modelName,
      maxRetries: 100,
      initialDelay: 5000,
      maxDelay: 180000,
      backoffFactor: 1.2,
      executionTimeout: process.env.USE_FLEX === 'true' && modelConfig?.provider === 'google'
        ? 900000  // 15 minutes for flex tier (queued requests)
        : 300000, // 5 minutes default
      abortSignal: params.abortSignal,
    })
  });
}

/**
 * Helper to attach model config to the parameters for concurrency tracking.
 * Use this when calling streamTextWithConcurrency to ensure proper per-model limiting.
 *
 * @param params - streamText parameters
 * @param modelConfig - The Model configuration object
 * @returns Parameters with attached model config
 */
export function withModelConfig<T extends Parameters<typeof streamText>[0]>(
  params: T,
  modelConfig: Model
): T & { __modelConfig: Model } {
  return {
    ...params,
    __modelConfig: modelConfig
  } as T & { __modelConfig: Model };
}
