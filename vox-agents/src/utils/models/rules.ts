/**
 * @module utils/models/rules
 *
 * Model-name rules used for discovered model defaults and missing known-model
 * configuration synthesis.
 */

import type { LLMConfig } from '../../types/index.js';
import { isSynthesizableModelId } from '../../types/constants.js';
import type { DiscoveredModel } from '../../types/api.js';

/** A case-insensitive provider and native-name rule that contributes model options. */
export interface ModelRule {
  provider?: string | string[];
  match: RegExp;
  options?: LLMConfig['options'];
}

/**
 * Providers that serve open-weight models over an OpenAI-compatible surface, where
 * tool calls go through prompt middleware. First-party hosted providers (openai,
 * anthropic, google, codex, claude-code) call tools natively and are excluded.
 */
const openWeightProviders = ['openai-compatible', 'chutes', 'synthetic'];

/**
 * Applies the established configuration defaults to discovered model names.
 * Later matches deliberately win through shallow option merging.
 */
export const modelRules: ModelRule[] = [
  { provider: openWeightProviders, match: /gpt-oss/i, options: { toolMiddleware: 'prompt' } },
  { provider: openWeightProviders, match: /kimi/i, options: { toolMiddleware: 'prompt' } },
  { provider: openWeightProviders, match: /glm/i, options: { toolMiddleware: 'prompt' } },
  { provider: openWeightProviders, match: /nemotron/i, options: { toolMiddleware: 'prompt' } },
  { provider: openWeightProviders, match: /deepseek-v3/i, options: { toolMiddleware: 'prompt' } },
  { provider: openWeightProviders, match: /gemma-4/i, options: { toolMiddleware: 'prompt' } },
  { provider: openWeightProviders, match: /qwen/i, options: { systemPromptFirst: true, toolMiddleware: 'prompt' } },
  { provider: openWeightProviders, match: /minimax/i, options: { toolMiddleware: 'prompt', thinkMiddleware: 'think' } },
  { provider: 'claude-code', match: /.*/, options: { concurrencyLimit: 1 } },
  { provider: 'codex', match: /gpt-5\.6-sol/i, options: { concurrencyLimit: 1 } },
  { provider: 'codex', match: /gpt-5\.6-terra/i, options: { concurrencyLimit: 2 } },
  { provider: ['openai', 'codex'], match: /gpt-5\.6/i, options: { reasoningEffort: 'high' } },
  { match: /gemma-3/i, options: { toolMiddleware: 'gemma' } },
  { match: /embedder/i, options: { embeddingSize: 4096 } },
];

/** A provider-specific set of catalog-name rules for main, routine, and escalation models. */
interface TierRule {
  provider: string;
  default: RegExp;
  small: RegExp;
  large?: RegExp;
}

/** Preferred main and routine models (and an escalation model where one is obvious), matched in provider catalog order. */
export const tierRules: TierRule[] = [
  { provider: 'codex', default: /terra/i, small: /luna/i },
  { provider: 'claude-code', default: /^sonnet$/i, small: /^haiku$/i },
  // Synthetic tier IDs are exact service-side aliases, matched verbatim and case-sensitively.
  { provider: 'synthetic', default: /^syn:large:text$/, small: /^syn:small:text$/ },
];

/** Returns a provider's available main, routine, and escalation model recommendations. */
export function recommendTierModels(
  provider: string,
  models: DiscoveredModel[],
): { default?: string; small?: string; large?: string } | undefined {
  const rule = tierRules.find((candidate) => candidate.provider === provider);
  if (!rule) return undefined;

  const defaultModel = models.find((model) => rule.default.test(model.name));
  const smallModel = models.find((model) => rule.small.test(model.name));
  const largeRule = rule.large;
  const largeModel = largeRule === undefined ? undefined : models.find((model) => largeRule.test(model.name));
  if (!defaultModel && !smallModel && !largeModel) return undefined;
  return {
    ...(defaultModel === undefined ? {} : { default: defaultModel.id }),
    ...(smallModel === undefined ? {} : { small: smallModel.id }),
    ...(largeModel === undefined ? {} : { large: largeModel.id }),
  };
}

/** Applies all matching model-name rules without translating request-time provider options. */
export function applyModelRules(provider: string, name: string): LLMConfig['options'] | undefined {
  const matches = modelRules.filter((rule) => {
    const providers = rule.provider === undefined ? undefined : Array.isArray(rule.provider) ? rule.provider : [rule.provider];
    return (providers === undefined || providers.some((candidate) => candidate === provider))
      && rule.match.test(name);
  });
  if (matches.length === 0) return undefined;
  return matches.reduce<NonNullable<LLMConfig['options']>>((options, rule) => ({ ...options, ...rule.options }), {});
}

/**
 * Synthesizes a configuration for a known provider-qualified model identifier.
 * Request-time reasoning and provider-option translation remain in models.ts.
 */
export function synthesizeModelConfig(id: string): LLMConfig | undefined {
  const separator = id.indexOf('/');
  if (separator <= 0 || separator === id.length - 1) return undefined;

  const provider = id.slice(0, separator);
  const name = id.slice(separator + 1);
  if (!isSynthesizableModelId(id)) return undefined;

  const options = applyModelRules(provider, name);
  return {
    provider,
    name,
    ...(options === undefined ? {} : { options }),
  };
}
