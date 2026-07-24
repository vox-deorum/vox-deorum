/**
 * Tests for the shared required-tool-choice middleware: the wire-level
 * conversion to auto, the preserved requirement instruction, and the getModel
 * wiring for Anthropic (direct and Claude on Vertex). The Codex wiring is
 * covered end-to-end in codex.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { requiredToolChoiceMiddleware } from '../../../../src/utils/models/providers/required-tool-choice.js';

// Hoisted holder so the (hoisted) provider mocks can expose their created model
// instances, whose built-in doGenerateCalls recorder captures transformed params.
const mocks = vi.hoisted(() => ({
  anthropic: undefined as any,
  vertexAnthropic: undefined as any,
}));

/** A recording model whose doGenerate succeeds with a plain text response. */
function recordingModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    } as any),
  });
}

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => (_name: string) => (mocks.anthropic = recordingModel()),
}));
vi.mock('@ai-sdk/google-vertex/anthropic', () => ({
  createVertexAnthropic: () => (_name: string) => (mocks.vertexAnthropic = recordingModel()),
}));

import { getModel } from '../../../../src/utils/models/models.js';

/** Baseline call options with a required tool choice and one client function tool. */
function requiredParams(): any {
  return {
    prompt: [
      { role: 'system', content: 'Make sound strategic decisions.' },
      { role: 'user', content: [{ type: 'text', text: 'Take the turn.' }] },
    ],
    tools: [{
      type: 'function',
      name: 'found_city',
      description: 'Found a city.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    }],
    toolChoice: { type: 'required' },
  };
}

describe('requiredToolChoiceMiddleware', () => {
  const middleware = requiredToolChoiceMiddleware();

  it('converts required to auto and appends the requirement to the system prompt', async () => {
    const params = requiredParams();
    const out: any = await (middleware.transformParams as any)({ params });
    expect(out.toolChoice).toEqual({ type: 'auto' });
    expect(out.prompt[0].content).toContain('Make sound strategic decisions.');
    expect(out.prompt[0].content).toContain('final-output requirement');
    expect(out.prompt[0].content).toContain('client-provided tools: `found_city`');
    // The caller's params survive untouched for outer retries.
    expect(params.toolChoice).toEqual({ type: 'required' });
    expect(params.prompt[0].content).toBe('Make sound strategic decisions.');
  });

  it('creates a leading system message when the prompt has none', async () => {
    const params = { ...requiredParams(), prompt: [{ role: 'user', content: [{ type: 'text', text: 'Go.' }] }] };
    const out: any = await (middleware.transformParams as any)({ params });
    expect(out.prompt).toHaveLength(2);
    expect(out.prompt[0].role).toBe('system');
    expect(out.prompt[0].content).toContain('`found_city`');
  });

  it('degrades to plain auto when no client function tools are declared', async () => {
    const params = { ...requiredParams(), tools: [] };
    const out: any = await (middleware.transformParams as any)({ params });
    expect(out.toolChoice).toEqual({ type: 'auto' });
    expect(out.prompt).toBe(params.prompt);
  });

  it('returns non-required params unchanged', async () => {
    const params = { ...requiredParams(), toolChoice: { type: 'auto' } };
    const out: any = await (middleware.transformParams as any)({ params });
    expect(out).toBe(params);
  });
});

describe('getModel required-tool-choice wiring', () => {
  it('adapts a required tool choice for the anthropic provider', async () => {
    const model = getModel({ provider: 'anthropic', name: 'claude-sonnet-4-5' } as any);
    await (model as any).doGenerate({ ...requiredParams(), providerOptions: {} });
    const call = mocks.anthropic.doGenerateCalls.at(-1);
    expect(call.toolChoice).toEqual({ type: 'auto' });
    expect(call.prompt[0].content).toContain('final-output requirement');
  });

  it('adapts a required tool choice for Claude on Vertex (google provider)', async () => {
    const model = getModel({ provider: 'google', name: 'claude-sonnet-4-5' } as any);
    await (model as any).doGenerate({ ...requiredParams(), providerOptions: {} });
    const call = mocks.vertexAnthropic.doGenerateCalls.at(-1);
    expect(call.toolChoice).toEqual({ type: 'auto' });
    expect(call.prompt[0].content).toContain('final-output requirement');
  });
});
