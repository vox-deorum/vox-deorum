/**
 * Tests for the `claude-code` provider branch of getModel/getModelConfig.
 *
 * This is the first per-provider unit test for `models.ts`. We mock the
 * `ai-sdk-provider-claude-code` package (both exports) so the factory returns a
 * MockLanguageModelV3 the middleware tail can wrap, and capture the settings the
 * factory receives to assert how the claude-code case translates model config.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';

// Hoisted holder so the (hoisted) vi.mock factory can record captured settings.
const mocks = vi.hoisted(() => ({ captured: undefined as any }));

vi.mock('ai-sdk-provider-claude-code', () => {
  const factory = vi.fn((_id: string, settings: any) => {
    mocks.captured = settings;
    return new MockLanguageModelV3();
  });
  return { createClaudeCode: () => factory, claudeCode: factory };
});

import { getModel, getModelConfig } from '../../../src/utils/models/models.js';

describe('claude-code provider', () => {
  beforeEach(() => {
    mocks.captured = undefined;
  });

  describe('getModelConfig registration', () => {
    it('should resolve claude-code/sonnet to the registered default entry', () => {
      // The registered entry carries empty options: prompt-mode tool calling is forced
      // unconditionally in getModel's 'claude-code' case (claude-code has no native tool calling),
      // so it is NOT stored on the config (see config/defaults.ts).
      expect(getModelConfig('claude-code/sonnet')).toMatchObject({
        provider: 'claude-code',
        name: 'sonnet',
      });
      expect(getModelConfig('claude-code/sonnet').options?.toolMiddleware).toBeUndefined();
    });

    it('should register opus and haiku variants', () => {
      expect(getModelConfig('claude-code/opus')).toMatchObject({ provider: 'claude-code', name: 'opus' });
      expect(getModelConfig('claude-code/haiku')).toMatchObject({ provider: 'claude-code', name: 'haiku' });
    });
  });

  describe('getModel settings translation', () => {
    it('should isolate filesystem settings and disable all built-in tools', () => {
      getModel({ provider: 'claude-code', name: 'sonnet', options: { toolMiddleware: 'prompt' } });
      expect(mocks.captured).toBeDefined();
      expect(mocks.captured.settingSources).toEqual([]);
      expect(mocks.captured.tools).toEqual([]);
    });

    it('should map a non-minimal reasoningEffort to effort with no thinking override', () => {
      getModel({
        provider: 'claude-code',
        name: 'opus',
        options: { toolMiddleware: 'prompt', reasoningEffort: 'high' }
      });
      expect(mocks.captured.effort).toBe('high');
      expect(mocks.captured.thinking).toBeUndefined();
    });

    it('should map a minimal reasoningEffort to disabled thinking with no effort', () => {
      getModel({
        provider: 'claude-code',
        name: 'sonnet',
        options: { toolMiddleware: 'prompt', reasoningEffort: 'minimal' }
      });
      expect(mocks.captured.thinking).toEqual({ type: 'disabled' });
      expect(mocks.captured.effort).toBeUndefined();
    });

    it('should omit effort and thinking when no reasoningEffort is configured', () => {
      getModel({ provider: 'claude-code', name: 'haiku', options: { toolMiddleware: 'prompt' } });
      expect(mocks.captured.effort).toBeUndefined();
      expect(mocks.captured.thinking).toBeUndefined();
    });
  });
});
