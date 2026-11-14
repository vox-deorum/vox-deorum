/** Tests for shared model-reference parsing and formatting. */

import { describe, expect, it } from 'vitest';
import { formatModelReference, parseModelReference } from '../../../../src/agents/models/model-reference.js';

describe('model references', () => {
  it('should parse recognized reasoning suffixes case-insensitively', () => {
    expect(parseModelReference('codex/GPT-5.6-Sol@HIGH')).toEqual({
      fullKey: 'codex/GPT-5.6-Sol', provider: 'codex', name: 'GPT-5.6-Sol', reasoningEffort: 'high',
    });
  });

  it('should preserve unrecognized suffixes in provider-native names', () => {
    expect(parseModelReference('openrouter/team/model@preview')).toEqual({
      fullKey: 'openrouter/team/model@preview', provider: 'openrouter', name: 'team/model@preview',
    });
  });

  it('should support legacy empty telemetry suffixes and formatting', () => {
    expect(parseModelReference('anthropic/claude-sonnet@')).toMatchObject({ fullKey: 'anthropic/claude-sonnet' });
    expect(formatModelReference({ provider: 'codex', name: 'gpt-5.6-sol', options: { reasoningEffort: 'high' } }))
      .toBe('codex/gpt-5.6-sol@high');
  });
});
