/**
 * Tests for the shared required-tool-choice middleware: the wire-level conversion to auto, the
 * completion-tool instruction (the same for auto and required), and the getModel wiring for
 * Anthropic (direct and Claude on Vertex). The Codex wiring is covered end-to-end in codex.test.ts.
 *
 * The assertions compose against the exported `completionToolsInstruction` builder and check
 * structural properties (which names appear, whether a clause is present at all) rather than the
 * wording itself, so the injected prose can be edited without rewriting these tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import {
  requiredToolChoiceMiddleware,
  completionToolsInstruction,
} from '../../../../src/utils/models/providers/required-tool-choice.js';

// Hoisted holder so the (hoisted) provider mocks can expose their created model
// instances, whose built-in doGenerateCalls recorder captures transformed params.
const mocks = vi.hoisted(() => ({
  anthropic: undefined as any,
  vertexAnthropic: undefined as any,
}));

/** A recording model whose doGenerate succeeds with a plain text response. */
function recordingModel() {
  return new MockLanguageModelV4({
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

/** One declared client function tool. */
function functionTool(name: string): any {
  return {
    type: 'function',
    name,
    description: `Do ${name}.`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  };
}

/** Baseline call options with a required tool choice, one completion tool and one support tool. */
function requiredParams(): any {
  return {
    prompt: [
      { role: 'system', content: 'Make sound strategic decisions.' },
      { role: 'user', content: [{ type: 'text', text: 'Take the turn.' }] },
    ],
    tools: [functionTool('found_city'), functionTool('get_briefing')],
    toolChoice: { type: 'required' },
  };
}

describe('completionToolsInstruction', () => {
  it('yields nothing when no declared client tool completes the turn', () => {
    expect(completionToolsInstruction([], [], false)).toBeUndefined();
    expect(completionToolsInstruction([], ['found_city'], true)).toBeUndefined();
    expect(completionToolsInstruction(['get_briefing'], ['found_city'], true)).toBeUndefined();
  });

  it('names every completion tool and every support tool it was given', () => {
    const instruction = completionToolsInstruction(
      ['found_city', 'get_briefing'], ['found_city'], false,
    )!;
    expect(instruction).toContain('`found_city`');
    expect(instruction).toContain('`get_briefing`');
  });

  it('drops the support clause when every declared tool completes the turn', () => {
    const supportless = completionToolsInstruction(['found_city'], ['found_city'], false)!;
    const withSupport = completionToolsInstruction(['found_city', 'get_briefing'], ['found_city'], false)!;
    expect(supportless).not.toContain('`get_briefing`');
    expect(supportless.length).toBeLessThan(withSupport.length);
  });

  it('never names a completion tool the request does not declare', () => {
    const instruction = completionToolsInstruction(['found_city', 'get_briefing'], ['found_city', 'raze_city'], false)!;
    expect(instruction).not.toContain('`raze_city`');
  });

  it('counts host built-in tools as support alongside the non-completion client tools', () => {
    const named = ['found_city', 'get_briefing'];
    expect(completionToolsInstruction(named, ['found_city'], true))
      .not.toBe(completionToolsInstruction(named, ['found_city'], false));
  });
});

describe('requiredToolChoiceMiddleware', () => {
  it('converts required to auto and leaves the prompt alone without a completion tool', async () => {
    const params = requiredParams();
    const out: any = await (requiredToolChoiceMiddleware().transformParams as any)({ params });
    expect(out.toolChoice).toEqual({ type: 'auto' });
    expect(out.prompt).toBe(params.prompt);
    // The caller's params survive untouched for outer retries.
    expect(params.toolChoice).toEqual({ type: 'required' });
  });

  it('names the caller\'s completion tools as the ones that end the turn', async () => {
    const middleware = requiredToolChoiceMiddleware({ completionTools: ['found_city'] });
    const params = requiredParams();
    const out: any = await (middleware.transformParams as any)({ params });
    expect(out.prompt[0].content).toContain('found_city');
    expect(out.prompt[0].content).toContain('get_briefing');
    expect(out.prompt[0].content).not.toContain('raze_city');
    expect(out.toolChoice).toEqual({ type: 'auto' });
    expect(params.prompt[0].content).toBe('Make sound strategic decisions.');
  });

  it('gives auto and required the same system text', async () => {
    // A step whose tools were all removed drops to auto; its cached prefix must not move.
    const middleware = requiredToolChoiceMiddleware({ completionTools: ['found_city'] });
    const required: any = await (middleware.transformParams as any)({ params: requiredParams() });
    const auto: any = await (middleware.transformParams as any)({ params: { ...requiredParams(), toolChoice: { type: 'auto' } } });
    expect(auto.toolChoice).toEqual({ type: 'auto' });
    expect(auto.prompt).toEqual(required.prompt);
  });

  it('intersects the completion tools with what the request declares', async () => {
    // The agent completes through `found_city`, but this request only declares the support tool, so
    // the prompt must not advertise a completion the model cannot call.
    const params = { ...requiredParams(), tools: [functionTool('get_briefing')] };
    const middleware = requiredToolChoiceMiddleware({ completionTools: ['found_city'] });
    const out: any = await (middleware.transformParams as any)({ params });
    expect(out.prompt).toBe(params.prompt);
  });

  it('reports declared host tools to the instruction builder', async () => {
    const params = {
      ...requiredParams(),
      tools: [functionTool('found_city'), { type: 'provider', id: 'codex.shell', name: 'shell', args: {} }],
    };
    const middleware = requiredToolChoiceMiddleware({ completionTools: ['found_city'] });
    const out: any = await (middleware.transformParams as any)({ params });
    expect(out.prompt[0].content).toContain('found_city');
    expect(out.tools.some((tool: any) => tool.type === 'provider' && tool.id === 'codex.shell')).toBe(true);
  });

  it('creates a leading system message when the prompt has none', async () => {
    const params = { ...requiredParams(), prompt: [{ role: 'user', content: [{ type: 'text', text: 'Go.' }] }] };
    const middleware = requiredToolChoiceMiddleware({ completionTools: ['found_city'] });
    const out: any = await (middleware.transformParams as any)({ params });
    expect(out.prompt).toHaveLength(2);
    expect(out.prompt[0].role).toBe('system');
    expect(out.prompt[0].content).toContain('found_city');
    expect(out.prompt[0].content).toContain('get_briefing');
  });

  it('returns auto params without a completion tool unchanged', async () => {
    const params = { ...requiredParams(), toolChoice: { type: 'auto' } };
    const out: any = await (requiredToolChoiceMiddleware().transformParams as any)({ params });
    expect(out).toBe(params);
  });
});

describe('getModel required-tool-choice wiring', () => {
  it('adapts a required tool choice for the anthropic provider', async () => {
    const model = getModel({ provider: 'anthropic', name: 'claude-sonnet-4-5' } as any);
    await (model as any).doGenerate({ ...requiredParams(), providerOptions: {} });
    const call = mocks.anthropic.doGenerateCalls.at(-1);
    expect(call.toolChoice).toEqual({ type: 'auto' });
  });

  it('adapts a required tool choice for Claude on Vertex (google provider)', async () => {
    const model = getModel({ provider: 'google', name: 'claude-sonnet-4-5' } as any);
    await (model as any).doGenerate({ ...requiredParams(), providerOptions: {} });
    const call = mocks.vertexAnthropic.doGenerateCalls.at(-1);
    expect(call.toolChoice).toEqual({ type: 'auto' });
  });

  it('forwards the agent completion tools passed by vox-context', async () => {
    const model = getModel(
      { provider: 'anthropic', name: 'claude-sonnet-4-5' } as any,
      { completionTools: ['found_city'] },
    );
    await (model as any).doGenerate({ ...requiredParams(), providerOptions: {} });
    const call = mocks.anthropic.doGenerateCalls.at(-1);
    expect(call.prompt[0].content).toContain('found_city');
    expect(call.prompt[0].content).toContain('get_briefing');
    expect(call.toolChoice).toEqual({ type: 'auto' });
  });
});
