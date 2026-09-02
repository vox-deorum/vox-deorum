/** Tests for normalized host-capability attributes on model-step telemetry. */

import { describe, expect, it } from 'vitest';
import { hostCapabilityTelemetryAttributes } from '../../../src/utils/telemetry/host-capabilities.js';
import type { Model } from '../../../src/types/config.js';

/** Build a model configuration for one provider and host-tool selection. */
function model(provider: Model['provider'], hostTools?: string[]): Model {
  return { provider, name: 'test', options: { hostTools } } as Model;
}

describe('hostCapabilityTelemetryAttributes', () => {
  it('does not add the attribute when no host capability is enabled', () => {
    expect(hostCapabilityTelemetryAttributes(model('codex'))).toEqual({});
  });

  it('records Write with its implied Read capability', () => {
    expect(hostCapabilityTelemetryAttributes(model('claude-code', ['Write']))).toEqual({
      'host.capability': 'read, write',
    });
  });

  it('expands everything and preserves individual Read and Web selections', () => {
    expect(hostCapabilityTelemetryAttributes(model('codex', ['everything']))).toEqual({
      'host.capability': 'read, write, web',
    });
    expect(hostCapabilityTelemetryAttributes(model('codex', ['Read', 'Web']))).toEqual({
      'host.capability': 'read, web',
    });
  });

  it('does not report host capabilities for providers that cannot enable them', () => {
    expect(hostCapabilityTelemetryAttributes(model('openai', ['everything']))).toEqual({});
  });
});
