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
import type { Model, ReasoningEffort } from '../../types/index.js';
import { ReasoningEfforts } from '../../types/config.js';

const logger = createLogger('OracleModelResolver');

/**
 * Parse a telemetry model string into provider/name and optional reasoning effort.
 *
 * Telemetry stores model as: `{provider}/{name}@{reasoningEffort}`
 * e.g. `openai-compatible/Kimi-K2.5@Medium`, `anthropic/claude-sonnet-4-6@`
 *
 * @param modelString - The model string from span attributes
 * @returns Parsed components
 */
function parseModelString(modelString: string): {
  fullKey: string;
  provider: string;
  name: string;
  reasoningEffort?: ReasoningEffort;
} {
  // Split off reasoning effort suffix
  const atIndex = modelString.lastIndexOf('@');
  let baseString: string;
  let reasoningEffort: string | undefined;

  if (atIndex !== -1) {
    baseString = modelString.substring(0, atIndex);
    reasoningEffort = modelString.substring(atIndex + 1).toLowerCase() || undefined;
  } else {
    baseString = modelString;
  }

  // Split provider/name
  const slashIndex = baseString.indexOf('/');
  const provider = slashIndex !== -1 ? baseString.substring(0, slashIndex) : baseString;
  const name = slashIndex !== -1 ? baseString.substring(slashIndex + 1) : baseString;

  // Validate reasoning effort
  const normalizedEffort = reasoningEffort && (ReasoningEfforts as readonly string[]).includes(reasoningEffort)
    ? reasoningEffort as ReasoningEffort
    : undefined;

  return {
    fullKey: baseString,
    provider,
    name,
    reasoningEffort: normalizedEffort,
  };
}

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

  const parsed = parseModelString(input);

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

  // Not found in config -- construct from parsed components
  logger.warn(`Model "${parsed.fullKey}" not found in config.llms, constructing from telemetry string`);
  return {
    provider: parsed.provider,
    name: parsed.name,
    options: parsed.reasoningEffort ? { reasoningEffort: parsed.reasoningEffort } : undefined,
  };
}
