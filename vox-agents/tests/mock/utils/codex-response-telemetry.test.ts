/** Tests for Codex proxy response metadata on model-step telemetry. */

import { describe, expect, it } from 'vitest';
import { codexResponseTelemetryAttributes } from '../../../src/utils/telemetry/codex-response.js';

describe('codexResponseTelemetryAttributes', () => {
  it('records instruction paths verbatim as an array attribute', () => {
    const source = String.raw`F:\project\AGENTS.md`;

    expect(codexResponseTelemetryAttributes({ codex: { instructionSources: [source] } })).toEqual({
      'host.instruction_sources': [source],
    });
  });

  it('ignores missing or malformed provider metadata', () => {
    expect(codexResponseTelemetryAttributes(undefined)).toEqual({});
    expect(codexResponseTelemetryAttributes({ codex: { instructionSources: ['ok', 3] } })).toEqual({});
    expect(codexResponseTelemetryAttributes({ openai: { instructionSources: ['ok'] } })).toEqual({});
  });

  it('records the thread reuse outcome as a host attribute', () => {
    expect(codexResponseTelemetryAttributes({ codex: { threadReuse: 'reused' } })).toEqual({
      'host.thread_reuse': 'reused',
    });
  });

  it('passes each thread reuse outcome through', () => {
    for (const value of ['reused', 'tried_failed', 'fresh'] as const) {
      expect(codexResponseTelemetryAttributes({ codex: { threadReuse: value } })).toEqual({
        'host.thread_reuse': value,
      });
    }
  });

  it('ignores an unrecognized thread reuse value', () => {
    expect(codexResponseTelemetryAttributes({ codex: { threadReuse: 'bogus' } })).toEqual({});
  });

  it('records instruction sources and thread reuse together', () => {
    expect(codexResponseTelemetryAttributes({ codex: { instructionSources: ['a'], threadReuse: 'fresh' } })).toEqual({
      'host.instruction_sources': ['a'],
      'host.thread_reuse': 'fresh',
    });
  });
});
