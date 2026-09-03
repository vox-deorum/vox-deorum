/** Tests for Codex proxy response metadata on model-step telemetry. */

import { describe, expect, it } from 'vitest';
import { codexResponseTelemetryAttributes } from '../../../src/utils/telemetry/codex-response.js';

describe('codexResponseTelemetryAttributes', () => {
  it('records instruction paths verbatim as an array attribute', () => {
    const source = String.raw`F:\project\AGENTS.md`;

    expect(codexResponseTelemetryAttributes({ codex: { instructionSources: [source] } })).toEqual({
      'codex.instruction_sources': [source],
    });
  });

  it('ignores missing or malformed provider metadata', () => {
    expect(codexResponseTelemetryAttributes(undefined)).toEqual({});
    expect(codexResponseTelemetryAttributes({ codex: { instructionSources: ['ok', 3] } })).toEqual({});
    expect(codexResponseTelemetryAttributes({ openai: { instructionSources: ['ok'] } })).toEqual({});
  });
});
