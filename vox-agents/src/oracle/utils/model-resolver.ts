/**
 * @module oracle/utils/model-resolver
 *
 * Resolves model configurations from strings or Model objects.
 * Parses the model format ({provider}/{name}@{reasoningEffort})
 * and looks up full configurations from config.llms.
 */

import { config } from '../../utils/config.js';
import { getModelConfig } from '../../utils/models/models.js';
import { createLogger } from '../../utils/logger.js';
import type { Model } from '../../types/index.js';
import { parseModelReference } from '../../utils/models/model-reference.js';
import { synthesizeModelConfig } from '../../utils/models/rules.js';
import { getRuntimeModel } from '../../utils/models/resolution.js';

const logger = createLogger('OracleModelResolver');

/**
 * Resolve a model input into a full Model configuration.
 * If given a Model object, returns it directly.
 * If given a string, parses it and looks up in config.llms.
 *
 * @param input - Model object or string (e.g. "openai-compatible/Kimi-K2.5@Medium")
 * @returns Resolved Model configuration
 */
export function resolveModel(input: string | Model): Model {
  if (typeof input !== 'string') {
    return input;
  }

  // Preserve an intentionally registered native name before parsing a suffix.
  const literalEntry = config.llms[input];
  if (literalEntry) {
    return typeof literalEntry === 'string' ? getModelConfig(literalEntry) : literalEntry;
  }

  const parsed = parseModelReference(input);

  // Try direct lookup in config.llms
  const llmEntry = config.llms[parsed.fullKey];

  if (llmEntry) {
    if (typeof llmEntry === 'string') {
      // It's an alias -- resolve through getModelConfig
      return getModelConfig(llmEntry, parsed.reasoningEffort);
    }

    // Apply reasoning effort if present
    if (parsed.reasoningEffort) {
      return {
        ...llmEntry,
        options: { ...llmEntry.options, reasoningEffort: parsed.reasoningEffort },
      };
    }
    return llmEntry;
  }

  const runtimeModel = getRuntimeModel(parsed.fullKey);
  if (runtimeModel) {
    return parsed.reasoningEffort
      ? { ...runtimeModel, options: { ...runtimeModel.options, reasoningEffort: parsed.reasoningEffort } }
      : runtimeModel;
  }

  // Preserve the same provider rules as normal model resolution for replayed models.
  const synthesized = synthesizeModelConfig(parsed.fullKey);
  if (synthesized) {
    return parsed.reasoningEffort
      ? { ...synthesized, options: { ...synthesized.options, reasoningEffort: parsed.reasoningEffort } }
      : synthesized;
  }

  // Unknown providers retain telemetry's verbatim provider/name construction.
  logger.warn(`Model "${parsed.fullKey}" not found in config.llms, constructing from telemetry string`);
  return {
    provider: parsed.provider,
    name: parsed.name,
    options: parsed.reasoningEffort ? { reasoningEffort: parsed.reasoningEffort } : undefined,
  };
}
