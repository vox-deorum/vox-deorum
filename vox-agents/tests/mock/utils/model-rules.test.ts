/** Tests for model-name rules and missing known-provider configuration synthesis. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    llms: {
      default: { provider: 'openai', name: 'configured-default' },
      'openai/gpt-oss-registered': { provider: 'openai', name: 'explicit-name' },
    },
  },
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/utils/config.js', () => ({ config: mocks.config }));
vi.mock('../../../src/utils/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));

import { getModelConfig } from '../../../src/utils/models/models.js';
import { applyModelRules, modelRules, recommendTierModels, synthesizeModelConfig, tierRules } from '../../../src/utils/models/rules.js';
import { isSynthesizableModelId } from '../../../src/types/constants.js';

describe('model rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.llms = {
      default: { provider: 'openai', name: 'configured-default' },
      'openai/gpt-oss-registered': { provider: 'openai', name: 'explicit-name' },
    };
  });

  it('should merge overlapping rules case-insensitively', () => {
    const length = modelRules.length;
    modelRules.push(
      { provider: 'fixture-provider', match: /alpha/i, options: { toolMiddleware: 'prompt', concurrencyLimit: 1 } },
      { provider: ['fixture-provider', 'fixture-alias'], match: /alpha-beta/i, options: { concurrencyLimit: 2, embeddingSize: 2048 } },
    );
    try {
      expect(applyModelRules('fixture-provider', 'ALPHA-BETA')).toEqual({
        toolMiddleware: 'prompt', concurrencyLimit: 2, embeddingSize: 2048,
      });
      expect(applyModelRules('fixture-alias', 'alpha-beta')).toEqual({
        concurrencyLimit: 2, embeddingSize: 2048,
      });
    } finally {
      modelRules.splice(length);
    }
  });

  it('should shallow-merge later rules and accept provider arrays', () => {
    const length = modelRules.length;
    modelRules.push(
      { provider: ['openai', 'google'], match: /temporary/i, options: { toolMiddleware: 'prompt', concurrencyLimit: 1 } },
      { provider: 'openai', match: /temporary/i, options: { concurrencyLimit: 2 } },
    );
    try {
      expect(applyModelRules('openai', 'temporary-model')).toEqual({ toolMiddleware: 'prompt', concurrencyLimit: 2 });
      expect(applyModelRules('google', 'temporary-model')).toEqual({ toolMiddleware: 'prompt', concurrencyLimit: 1 });
    } finally {
      modelRules.splice(length);
    }
  });

  it('should synthesize a known provider configuration from matching rules', () => {
    const length = modelRules.length;
    modelRules.push({
      provider: 'openai-compatible',
      match: /^controlled-fixture$/i,
      options: { toolMiddleware: 'prompt', embeddingSize: 768 },
    });
    try {
      expect(synthesizeModelConfig('openai-compatible/Controlled-Fixture')).toEqual({
        provider: 'openai-compatible',
        name: 'Controlled-Fixture',
        options: { toolMiddleware: 'prompt', embeddingSize: 768 },
      });
    } finally {
      modelRules.splice(length);
    }
  });

  it('should not synthesize an agent identifier or unsupported provider', () => {
    expect(synthesizeModelConfig('strategist')).toBeUndefined();
    expect(synthesizeModelConfig('unknown/example')).toBeUndefined();
  });

  it('should share provider-qualified ID validation with configuration synthesis', () => {
    expect(isSynthesizableModelId('codex/gpt-5.6-terra')).toBe(true);
    expect(isSynthesizableModelId('codex/   ')).toBe(false);
    expect(synthesizeModelConfig('codex/   ')).toBeUndefined();
  });

  it('should preserve explicit registry precedence over matching rules', () => {
    expect(getModelConfig('openai/gpt-oss-registered')).toEqual({
      provider: 'openai', name: 'explicit-name',
    });
  });

  it('should apply reasoning to a synthesized model and log it only on first use', () => {
    expect(getModelConfig('openai/gpt-oss-synth', 'high')).toMatchObject({
      provider: 'openai',
      name: 'gpt-oss-synth',
      options: { reasoningEffort: 'high' },
    });
    const logged = mocks.logger.info.mock.calls.length;
    expect(logged).toBeGreaterThan(0);
    getModelConfig('openai/gpt-oss-synth', 'high');
    expect(mocks.logger.info).toHaveBeenCalledTimes(logged);
  });

  it('should scope prompt middleware to open-weight providers', () => {
    expect(applyModelRules('openai-compatible', 'gpt-oss-120b')).toEqual({ toolMiddleware: 'prompt' });
    expect(applyModelRules('chutes', 'zai-org/glm-4.7')).toEqual({ toolMiddleware: 'prompt' });
    expect(applyModelRules('synthetic', 'hf:moonshotai/Kimi-K2.6')).toEqual({ toolMiddleware: 'prompt' });
  });

  it('should leave natively tool-calling providers without prompt middleware', () => {
    expect(applyModelRules('openai', 'gpt-oss-120b')).toBeUndefined();
    expect(applyModelRules('anthropic', 'claude-sonnet-5')).toBeUndefined();
    expect(applyModelRules('google', 'gemini-3.6-flash')).toBeUndefined();
  });

  it('should omit unavailable tier recommendations without inventing catalog entries', () => {
    expect(recommendTierModels('openai', [{ id: 'openai/gpt', name: 'gpt' }])).toBeUndefined();
    expect(recommendTierModels('codex', [{ id: 'codex/gpt-5.6-terra', name: 'gpt-5.6-terra' }]))
      .toEqual({ default: 'codex/gpt-5.6-terra' });
    expect(recommendTierModels('synthetic', [])).toBeUndefined();
  });

  it('should recommend a large model only when the provider rule declares one', () => {
    tierRules.push({
      provider: 'temporary-tier',
      default: /main/i,
      small: /mini/i,
      large: /maximus/i,
    });
    try {
      expect(recommendTierModels('temporary-tier', [
        { id: 'temporary/mini', name: 'mini' },
        { id: 'temporary/maximus', name: 'maximus' },
        { id: 'temporary/main', name: 'main' },
      ])).toEqual({ default: 'temporary/main', small: 'temporary/mini', large: 'temporary/maximus' });
      // No rule hit for the escalation tier: the key is simply absent.
      expect(recommendTierModels('temporary-tier', [{ id: 'temporary/main', name: 'main' }]))
        .toEqual({ default: 'temporary/main' });
    } finally {
      tierRules.pop();
    }
  });

  it('should fall back from an unknown ID and warn only on first use', () => {
    expect(getModelConfig('missing-provider/example')).toEqual({
      provider: 'openai', name: 'configured-default',
    });
    const warned = mocks.logger.warn.mock.calls.length;
    expect(warned).toBeGreaterThan(0);
    getModelConfig('missing-provider/example');
    expect(mocks.logger.warn).toHaveBeenCalledTimes(warned);
  });
});
