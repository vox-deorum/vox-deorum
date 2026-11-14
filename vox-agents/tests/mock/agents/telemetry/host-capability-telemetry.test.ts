/** Tests for normalized host-capability attributes on model-step telemetry. */

import { describe, expect, it } from 'vitest';
import { hostCapabilityTelemetryAttributes } from '../../../../src/agents/telemetry/host-capabilities.js';
import type { FileAccess, Model, ResolvedFilesConfig } from '../../../../src/types/config.js';

/** Build a model configuration for one provider and host-tool selection. */
function model(provider: Model['provider'], hostTools?: string[]): Model {
  return { provider, name: 'test', options: { hostTools } } as Model;
}

/** Build a resolved files setting with the given game access and shared mounts. */
function files(game: FileAccess | false, shared: Record<string, FileAccess> = {}): ResolvedFilesConfig {
  return { game, shared, quota: 5 };
}

describe('hostCapabilityTelemetryAttributes', () => {
  describe('with no files setting', () => {
    it('should add no attribute when no host capability is enabled', () => {
      expect(hostCapabilityTelemetryAttributes(model('codex'))).toEqual({});
      expect(hostCapabilityTelemetryAttributes(model('codex', []))).toEqual({});
    });

    it('should record web for a CLI provider with Web enabled', () => {
      expect(hostCapabilityTelemetryAttributes(model('codex', ['Web']))).toEqual({
        'host.capability': 'web',
      });
      expect(hostCapabilityTelemetryAttributes(model('claude-code', ['Web']))).toEqual({
        'host.capability': 'web',
      });
    });

    it('should not report host capabilities for providers that cannot enable them', () => {
      expect(hostCapabilityTelemetryAttributes(model('openai', ['Web']))).toEqual({});
    });
  });

  describe('with files on', () => {
    it('should record write when files are writable, even on a non-CLI provider', () => {
      expect(hostCapabilityTelemetryAttributes(model('openai'), files('write'))).toEqual({
        'host.capability': 'write',
      });
    });

    it('should record read when files are mounted read-only on a non-CLI provider', () => {
      expect(hostCapabilityTelemetryAttributes(model('openai'), files('read'))).toEqual({
        'host.capability': 'read',
      });
    });

    it('should record write when only a shared mount is writable', () => {
      expect(hostCapabilityTelemetryAttributes(model('openai'), files(false, { library: 'write' }))).toEqual({
        'host.capability': 'write',
      });
    });

    it('should record write before web for a CLI provider with Web and writable files', () => {
      expect(hostCapabilityTelemetryAttributes(model('codex', ['Web']), files('write'))).toEqual({
        'host.capability': 'write,web',
      });
    });
  });
});
