/** Tests for the shared host meta-tool policy. */

import { describe, expect, it } from 'vitest';
import {
  isHostCapabilityProvider,
  resolveHostToolCapabilities,
} from '../../../../../src/agents/models/providers/host-tools.js';

describe('resolveHostToolCapabilities', () => {
  it('enables web for the Web meta-tool', () => {
    expect(resolveHostToolCapabilities(['Web'])).toEqual({ web: true });
  });

  it('denies missing or empty host tools', () => {
    expect(resolveHostToolCapabilities(undefined)).toEqual({ web: false });
    expect(resolveHostToolCapabilities([])).toEqual({ web: false });
  });

  it('fails fast on entries outside the Web whitelist', () => {
    for (const requested of [['Read'], ['Write'], ['everything'], ['Bash'], ['Web', 'Read']]) {
      expect(() => resolveHostToolCapabilities(requested)).toThrow('Unsupported hostTools entries');
    }
  });
});

describe('isHostCapabilityProvider', () => {
  it('accepts the CLI providers that execute their own capabilities', () => {
    expect(isHostCapabilityProvider('codex')).toBe(true);
    expect(isHostCapabilityProvider('claude-code')).toBe(true);
  });

  it('rejects every other provider', () => {
    expect(isHostCapabilityProvider('openrouter')).toBe(false);
  });
});
