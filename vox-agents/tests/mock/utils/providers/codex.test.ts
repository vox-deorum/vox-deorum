/** Tests for the Codex compatible-provider boundary. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const proxyMocks = vi.hoisted(() => ({
  ensureCodexProxy: vi.fn<() => Promise<void>>(),
  invalidateConnection: vi.fn(),
}));

vi.mock('../../../../src/utils/models/providers/codex-proxy.js', async () => {
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return {
    ensureCodexProxy: proxyMocks.ensureCodexProxy,
    getCodexExecutionTimeout: () => 375_000,
    getCodexProxyApiBase: () => 'http://127.0.0.1:8787/v1',
    getCodexProxyConfig: () => ({
      port: 8787,
      root: join(tmpdir(), 'vox-codex-provider-test'),
      startupTimeoutMs: 300_000,
      requestTimeoutMs: 30_000,
      shutdownGracePeriodMs: 15_000,
    }),
    codexProxyManager: { invalidateConnection: proxyMocks.invalidateConnection },
  };
});

import { buildCodexModel, buildCodexProviderOptions } from '../../../../src/utils/models/providers/codex.js';

const testProxyRoot = path.join(os.tmpdir(), 'vox-codex-provider-test');

/** Creates a standard non-streaming Chat Completions response. */
function completion(message: Record<string, unknown>, finishReason: string): Response {
  return new Response(JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-5.4-mini',
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** Returns the common native client tool passed through the compatible adapter. */
function foundCityTool(): any {
  return {
    type: 'function',
    name: 'found_city',
    description: 'Found a city at the chosen location.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  };
}

/** Parses every request body captured by the global fetch double. */
function capturedBodies(fetchMock: ReturnType<typeof vi.fn>): any[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
}

beforeEach(() => {
  proxyMocks.ensureCodexProxy.mockReset().mockResolvedValue(undefined);
  proxyMocks.invalidateConnection.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(testProxyRoot, { recursive: true, force: true });
});

describe('Codex provider options', () => {
  it('sends the default-denied extension without a cwd when host tools are empty', () => {
    expect(buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }))
      .toEqual({ codex: { x_codex: { sandbox: 'read-only', web_search: 'disabled' } } });
    expect(fs.existsSync(testProxyRoot)).toBe(false);
  });

  it('whitelists reasoning effort and excludes unrelated Vox options', () => {
    expect(buildCodexProviderOptions({
      provider: 'codex',
      name: 'gpt-5.4-mini',
      options: {
        reasoningEffort: 'high', hostTools: [], toolMiddleware: 'rescue',
        concurrencyLimit: 1, thinkMiddleware: 'think', systemPromptFirst: true,
        framing: 'tool', embeddingSize: 10, unknown: 'ignored',
      },
    })).toEqual({
      codex: { reasoningEffort: 'high', x_codex: { sandbox: 'read-only', web_search: 'disabled' } },
    });
  });

  it('maps everything to a workspace-write sandbox with live search in a scoped cwd', () => {
    expect(buildCodexProviderOptions(
      { provider: 'codex', name: 'gpt-5.4-mini', options: { hostTools: ['everything'] } },
      { workingDirId: 'g1-2' },
    )).toEqual({
      codex: {
        x_codex: {
          sandbox: 'workspace-write',
          web_search: 'live',
          cwd: path.join(testProxyRoot, 'g1-2'),
        },
      },
    });
    expect(fs.existsSync(path.join(testProxyRoot, 'g1-2'))).toBe(true);
  });

  it('keeps Read on the read-only, search-disabled floor with an isolated cwd', () => {
    expect(buildCodexProviderOptions(
      { provider: 'codex', name: 'gpt-5.4-mini', options: { hostTools: ['Read'] } },
    )).toEqual({
      codex: {
        x_codex: {
          sandbox: 'read-only',
          web_search: 'disabled',
          cwd: path.join(testProxyRoot, 'default'),
        },
      },
    });
  });

  it('enables live search for Web without granting write access', () => {
    expect(buildCodexProviderOptions(
      { provider: 'codex', name: 'gpt-5.4-mini', options: { hostTools: ['Web'] } },
    )).toEqual({
      codex: {
        x_codex: {
          sandbox: 'read-only',
          web_search: 'live',
          cwd: path.join(testProxyRoot, 'default'),
        },
      },
    });
  });

  it('rejects names outside the meta-tool vocabulary', () => {
    expect(() => buildCodexProviderOptions({
      provider: 'codex', name: 'gpt-5.4-mini', options: { hostTools: ['Bash'] },
    })).toThrow('Unsupported hostTools entries');
  });
});

describe('Codex model middleware', () => {
  it.each(['prompt', 'gemma'])('rejects %s because Codex requires native tools', (toolMiddleware) => {
    expect(() => buildCodexModel({
      provider: 'codex', name: 'gpt-5.4-mini', options: { toolMiddleware },
    })).toThrow('Codex requires native function tools');
  });
});

describe('Codex compatible adapter requests', () => {
  it('serializes only the Codex extension, reasoning effort, and standard client tools', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion(
      { role: 'assistant', content: 'Ready.' },
      'stop',
    ));
    vi.stubGlobal('fetch', fetchMock);
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });
    const providerOptions = buildCodexProviderOptions({
      provider: 'codex',
      name: 'gpt-5.4-mini',
      options: {
        reasoningEffort: 'high', hostTools: [], toolMiddleware: 'rescue',
        concurrencyLimit: 2, systemPromptFirst: true, embeddingSize: 12, unknown: 'private',
      },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Choose a city.' }] }],
      providerOptions,
      tools: [foundCityTool()],
      toolChoice: { type: 'auto' },
    });

    expect(proxyMocks.ensureCodexProxy).toHaveBeenCalledTimes(1);
    const [body] = capturedBodies(fetchMock);
    expect(body).toMatchObject({
      model: 'gpt-5.4-mini',
      reasoning_effort: 'high',
      x_codex: { sandbox: 'read-only', web_search: 'disabled' },
      messages: [{ role: 'user', content: 'Choose a city.' }],
      tools: [{ type: 'function', function: { name: 'found_city' } }],
    });
    expect(body).not.toHaveProperty('hostTools');
    expect(body).not.toHaveProperty('toolMiddleware');
    expect(body).not.toHaveProperty('concurrencyLimit');
    expect(body).not.toHaveProperty('systemPromptFirst');
    expect(body).not.toHaveProperty('embeddingSize');
    expect(body).not.toHaveProperty('unknown');
  });

  it('continues a standard native function-tool turn with assistant and tool messages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-city',
          type: 'function',
          function: { name: 'found_city', arguments: '{"name":"Rome"}' },
        }],
      }, 'tool_calls'))
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Rome is founded.' }, 'stop'));
    vi.stubGlobal('fetch', fetchMock);
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });
    const providerOptions = buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' });
    const first = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Found Rome.' }] }],
      providerOptions,
      tools: [foundCityTool()],
      toolChoice: { type: 'auto' },
    });
    const toolCall = first.content.find((part) => part.type === 'tool-call');
    expect(toolCall).toMatchObject({
      type: 'tool-call', toolCallId: 'call-city', toolName: 'found_city', input: '{"name":"Rome"}',
    });
    const assistantToolCall = { ...toolCall!, input: JSON.parse(String(toolCall!.input)) };

    const second = await model.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Found Rome.' }] },
        // The high-level AI SDK parses the provider's JSON input before storing
        // its standard assistant tool-call message for the next model step.
        { role: 'assistant', content: [assistantToolCall] },
        {
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: 'call-city',
            toolName: 'found_city',
            output: { type: 'text', value: 'City founded at tile 10,12.' },
          }],
        },
      ],
      providerOptions,
      tools: [foundCityTool()],
      toolChoice: { type: 'auto' },
    });

    expect(second.content).toContainEqual({ type: 'text', text: 'Rome is founded.' });
    const [, continuation] = capturedBodies(fetchMock);
    expect(continuation.messages).toEqual([
      { role: 'user', content: 'Found Rome.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-city', type: 'function', function: { name: 'found_city', arguments: '{"name":"Rome"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'call-city', content: 'City founded at tile 10,12.' },
    ]);
  });

  it('awaits lazy proxy startup before sending the compatible request', async () => {
    let releaseStartup!: () => void;
    proxyMocks.ensureCodexProxy.mockReturnValue(new Promise<void>((resolve) => { releaseStartup = resolve; }));
    const fetchMock = vi.fn().mockResolvedValue(completion({ role: 'assistant', content: 'Ready.' }, 'stop'));
    vi.stubGlobal('fetch', fetchMock);
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });
    const pending = model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Wait.' }] }],
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
    });

    await vi.waitFor(() => expect(proxyMocks.ensureCodexProxy).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
    releaseStartup();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('invalidates proxy readiness after a connection TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')));
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });

    await expect(model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello.' }] }],
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
    })).rejects.toBeDefined();
    expect(proxyMocks.invalidateConnection).toHaveBeenCalledTimes(1);
  });
});
