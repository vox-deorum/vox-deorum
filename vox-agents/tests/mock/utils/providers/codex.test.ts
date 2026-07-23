/** Tests for the Codex compatible-provider boundary. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streamText, tool } from 'ai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

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
import { codexActivityMiddleware } from '../../../../src/utils/models/providers/codex-response.js';

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

/** Creates a Chat Completions SSE response from JSON payloads. */
function streamingCompletion(...chunks: Record<string, unknown>[]): Response {
  const body = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** Creates one proxy error response with its stable machine-readable code. */
function proxyErrorResponse(code: string, status = 409): Response {
  return new Response(JSON.stringify({
    error: {
      message: `Proxy rejected the request with ${code}.`,
      type: 'conflict_error',
      param: null,
      code,
    },
  }), { status, headers: { 'content-type': 'application/json' } });
}

/** Collects all parts from a V3 stream for assertions. */
async function streamParts(model: any, params: any): Promise<any[]> {
  const response = await model.doStream(params);
  const parts: any[] = [];
  for await (const part of response.stream) parts.push(part);
  return parts;
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
      .toEqual({ codex: { x_codex: { sandbox: 'disabled', web_search: 'disabled' } } });
    expect(fs.existsSync(testProxyRoot)).toBe(false);
  });

  it('keeps an explicit empty host tool list disabled without a cwd', () => {
    expect(buildCodexProviderOptions({
      provider: 'codex', name: 'gpt-5.4-mini', options: { hostTools: [] },
    })).toEqual({ codex: { x_codex: { sandbox: 'disabled', web_search: 'disabled' } } });
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
      codex: { reasoningEffort: 'high', x_codex: { sandbox: 'disabled', web_search: 'disabled' } },
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

  it('maps Write-only access to a workspace-write sandbox with an isolated cwd', () => {
    expect(buildCodexProviderOptions(
      { provider: 'codex', name: 'gpt-5.4-mini', options: { hostTools: ['Write'] } },
    )).toEqual({
      codex: {
        x_codex: {
          sandbox: 'workspace-write',
          web_search: 'disabled',
          cwd: path.join(testProxyRoot, 'default'),
        },
      },
    });
  });

  it('enables live search for Web without granting a sandbox or working directory', () => {
    expect(buildCodexProviderOptions(
      { provider: 'codex', name: 'gpt-5.4-mini', options: { hostTools: ['Web'] } },
    )).toEqual({
      codex: {
        x_codex: {
          sandbox: 'disabled',
          web_search: 'live',
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
      x_codex: { sandbox: 'disabled', web_search: 'disabled' },
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

  it.each([
    'continuation_policy_mismatch',
    'expired_tool_continuation',
    'thread_not_resumable',
    'tool_results_required',
  ])('marks deterministic proxy error %s as non-retryable', async (code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(proxyErrorResponse(
      code,
      code === 'expired_tool_continuation' ? 410 : 409,
    )));
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });

    await expect(model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Continue.' }] }],
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
    })).rejects.toMatchObject({ isRetryable: false });
  });
});

describe('Codex rc.3 built-in activity normalization', () => {
  it('normalizes raw non-stream activity into provider-executed dynamic tool parts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion({
      role: 'assistant',
      content: 'Searching.',
      tool_calls: [{
        id: 'builtin-search', type: 'function',
        function: { name: 'web_search', arguments: '{"query":"Rome"}' },
      }],
      tool_results: [{
        id: 'builtin-search', type: 'function',
        function: { name: 'web_search', arguments: '{"query":"Rome"}' },
        result: { status: 'completed', content: 'Rome was found.' },
      }],
    }, 'stop'));
    vi.stubGlobal('fetch', fetchMock);
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Find Rome.' }] }],
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
      tools: [foundCityTool()], toolChoice: { type: 'auto' },
    });

    expect(result.content).toContainEqual({
      type: 'tool-call', toolCallId: 'builtin-search', toolName: 'web_search',
      input: '{"query":"Rome"}', providerExecuted: true, dynamic: true,
    });
    expect(result.content).toContainEqual({
      type: 'tool-result', toolCallId: 'builtin-search', toolName: 'web_search',
      result: { status: 'completed', content: 'Rome was found.' }, dynamic: true,
    });
    expect(result.content.filter((part) => part.type === 'tool-call' && part.toolCallId === 'builtin-search')).toHaveLength(1);
    expect(result.finishReason).toEqual({ unified: 'stop', raw: 'stop' });
    expect(result.usage.inputTokens.total).toBe(10);
    expect(result.usage.outputTokens.total).toBe(4);
    expect(result.warnings).toEqual([]);
    expect(result.response).toMatchObject({ id: 'chatcmpl-test', modelId: 'gpt-5.4-mini' });
    expect(result.response?.timestamp).toBeInstanceOf(Date);
  });

  it('normalizes fragmented stream activity, keeps preliminary status, and hides internally enabled raw chunks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamingCompletion(
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'builtin-search', type: 'function', function: { name: 'web_search', arguments: '{"query":' } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Rome"}' } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_results: [{ id: 'builtin-search', type: 'function', function: { name: 'web_search', arguments: '{"query":"Rome"}' }, result: { status: 'in_progress', content: 'Looking.' } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_results: [{ id: 'builtin-search', type: 'function', function: { name: 'web_search', arguments: '{"query":"Rome"}' }, result: { status: 'completed', content: 'Found Rome.' } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });
    const parts = await streamParts(model, {
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Find Rome.' }] }],
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
      tools: [foundCityTool()], toolChoice: { type: 'auto' },
    });

    expect(parts).toContainEqual({
      type: 'tool-call', toolCallId: 'builtin-search', toolName: 'web_search',
      input: '{"query":"Rome"}', providerExecuted: true, dynamic: true,
    });
    expect(parts).toContainEqual({
      type: 'tool-result', toolCallId: 'builtin-search', toolName: 'web_search',
      result: { status: 'in_progress', content: 'Looking.' }, preliminary: true, dynamic: true,
    });
    expect(parts).toContainEqual({
      type: 'tool-result', toolCallId: 'builtin-search', toolName: 'web_search',
      result: { status: 'completed', content: 'Found Rome.' }, dynamic: true,
    });
    expect(parts.filter((part) => part.type === 'tool-call' && part.toolCallId === 'builtin-search')).toHaveLength(1);
    expect(parts.some((part) => part.type === 'raw')).toBe(false);
  });

  it('removes only provider-executed activity from mixed continuation history', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion({ role: 'assistant', content: 'Continued.' }, 'stop'));
    vi.stubGlobal('fetch', fetchMock);
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });

    await model.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Continue.' }] },
        { role: 'assistant', content: [
          { type: 'tool-call', toolCallId: 'builtin-search', toolName: 'web_search', input: { query: 'Rome' }, providerExecuted: true },
          { type: 'tool-call', toolCallId: 'call-city', toolName: 'found_city', input: { name: 'Rome' } },
        ] },
        { role: 'tool', content: [
          { type: 'tool-result', toolCallId: 'builtin-search', toolName: 'web_search', output: { type: 'text', value: 'Rome found.' } },
          { type: 'tool-result', toolCallId: 'call-city', toolName: 'found_city', output: { type: 'text', value: 'City founded.' } },
        ] },
      ],
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
      tools: [foundCityTool()], toolChoice: { type: 'auto' },
    });

    const [body] = capturedBodies(fetchMock);
    expect(JSON.stringify(body.messages)).not.toContain('builtin-search');
    expect(body.messages).toContainEqual(expect.objectContaining({ tool_call_id: 'call-city' }));
  });

  it('marks malformed activity as non-retryable protocol failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion({
      role: 'assistant', content: null,
      tool_results: [{ id: 'orphan', type: 'function', function: { name: 'web_search', arguments: '{' }, result: { status: 'completed' } }],
    }, 'stop'));
    vi.stubGlobal('fetch', fetchMock);
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });

    await expect(model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Find Rome.' }] }],
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
      tools: [foundCityTool()], toolChoice: { type: 'auto' },
    })).rejects.toMatchObject({ name: 'CodexProviderProtocolError', isRetryable: false });
  });

  it('fails closed when client and built-in calls reuse the same ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion({
      role: 'assistant', content: null,
      tool_calls: [
        { id: 'collision', type: 'function', function: { name: 'web_search', arguments: '{"query":"Rome"}' } },
        { id: 'collision', type: 'function', function: { name: 'found_city', arguments: '{"name":"Rome"}' } },
      ],
    }, 'tool_calls'));
    vi.stubGlobal('fetch', fetchMock);
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });

    await expect(model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Find Rome.' }] }],
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
      tools: [foundCityTool()], toolChoice: { type: 'auto' },
    })).rejects.toMatchObject({ name: 'CodexProviderProtocolError', isRetryable: false });
  });

  it('reclassifies a declared-name built-in result without releasing a client call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamingCompletion(
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'collision', type: 'function', function: { name: 'found_city', arguments: '{"name":"Rome"}' } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_results: [{ id: 'collision', type: 'function', function: { name: 'found_city', arguments: '{"name":"Rome"}' }, result: { status: 'failed', error: { message: 'Codex declined the action.' } } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });
    const parts = await streamParts(model, {
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Inspect Rome.' }] }],
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
      tools: [foundCityTool()], toolChoice: { type: 'auto' },
    });

    expect(parts).toContainEqual({ type: 'tool-call', toolCallId: 'collision', toolName: 'found_city', input: '{"name":"Rome"}', providerExecuted: true, dynamic: true });
    const result = parts.find((part) => part.type === 'tool-result' && part.toolCallId === 'collision');
    expect(result).toMatchObject({
      type: 'tool-result',
      toolCallId: 'collision',
      toolName: 'found_city',
      result: { status: 'failed', error: { message: 'Codex declined the action.' } },
      isError: true,
      dynamic: true,
    });
    expect(parts.some((part) => part.type === 'tool-input-start' && part.id === 'collision')).toBe(false);
  });

  it('promotes a provider failure and never executes a colliding built-in through AI SDK core', async () => {
    const localHandler = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamingCompletion(
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'collision', type: 'function', function: { name: 'found_city', arguments: '{"name":"Rome"}' } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_results: [{ id: 'collision', type: 'function', function: { name: 'found_city', arguments: '{"name":"Rome"}' }, result: { status: 'in_progress', progress: 'Inspecting.' } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_results: [{ id: 'collision', type: 'function', function: { name: 'found_city', arguments: '{"name":"Rome"}' }, result: { status: 'interrupted', error: { message: 'Inspection stopped.' } } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    )));

    const result = streamText({
      model: buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' }),
      prompt: 'Inspect Rome.',
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
      tools: {
        found_city: tool({
          description: 'Found a city.',
          inputSchema: z.object({ name: z.string() }),
          execute: localHandler,
        }),
      },
    });
    const parts: any[] = [];
    for await (const part of result.fullStream) parts.push(part);

    expect(localHandler).not.toHaveBeenCalled();
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'tool-call', toolCallId: 'collision', toolName: 'found_city',
      providerExecuted: true,
    }));
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'tool-result', toolCallId: 'collision', providerExecuted: true,
      output: { status: 'in_progress', progress: 'Inspecting.' },
    }));
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'tool-error', toolCallId: 'collision', providerExecuted: true,
      error: { status: 'interrupted', error: { message: 'Inspection stopped.' } },
    }));
  });

  it('releases a genuine send-message call before the terminal tool_calls finish', async () => {
    const sendMessage = { ...foundCityTool(), name: 'send-message' };
    const fetchMock = vi.fn().mockResolvedValue(streamingCompletion(
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'send-1', type: 'function', function: { name: 'send-message', arguments: '{"Message":"Rome"}' } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });
    const parts = await streamParts(model, {
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Send Rome a message.' }] }],
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
      tools: [sendMessage], toolChoice: { type: 'auto' },
    });
    const callIndex = parts.findIndex((part) => part.type === 'tool-call' && part.toolCallId === 'send-1');
    const finishIndex = parts.findIndex((part) => part.type === 'finish');

    expect(parts[callIndex]).toMatchObject({ type: 'tool-call', toolCallId: 'send-1', toolName: 'send-message', input: '{"Message":"Rome"}' });
    expect(parts[callIndex]).not.toHaveProperty('providerExecuted');
    expect(callIndex).toBeGreaterThanOrEqual(0);
    expect(callIndex).toBeLessThan(finishIndex);
  });

  it('keeps repeated preliminary activity and synthesizes a structured terminal failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamingCompletion(
      { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'search-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"Rome"}' } }] }, finish_reason: null }] },
      { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini', choices: [{ index: 0, delta: { tool_results: [{ id: 'search-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"Rome"}' }, result: { status: 'in_progress', content: 'First update.' } }] }, finish_reason: null }] },
      { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini', choices: [{ index: 0, delta: { tool_results: [{ id: 'search-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"Rome"}' }, result: { status: 'in_progress', content: 'Second update.' } }] }, finish_reason: null }] },
      { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const parts = await streamParts(buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' }), {
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Find Rome.' }] }], providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }), tools: [foundCityTool()], toolChoice: { type: 'auto' },
    });
    const results = parts.filter((part) => part.type === 'tool-result' && part.toolCallId === 'search-1');

    expect(results).toHaveLength(3);
    expect(results.slice(0, 2).every((part) => part.preliminary === true)).toBe(true);
    expect(results[2]).toMatchObject({
      result: { status: 'failed', error: { message: expect.any(String) } },
      isError: true,
    });
  });

  it.each(['failed', 'error', 'cancelled', 'canceled', 'interrupted'])(
    'normalizes terminal %s activity as an error',
    async (status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'status-result', type: 'function', function: { name: 'web_search', arguments: '{"query":"Rome"}' } },
        ],
        tool_results: [
          {
            id: 'status-result',
            type: 'function',
            function: { name: 'web_search', arguments: '{"query":"Rome"}' },
            result: { status, error: { message: 'Activity did not complete.' } },
          },
        ],
      }, 'stop')));
      const response = await buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' }).doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Find Rome.' }] }],
        providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
      });

      expect(response.content).toContainEqual(expect.objectContaining({
        type: 'tool-result',
        toolCallId: 'status-result',
        result: { status, error: { message: 'Activity did not complete.' } },
        isError: true,
      }));
    },
  );

  it('supports interleaved activity and rejects orphan, duplicate, and all post-activity disconnects', async () => {
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });
    const params = {
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Inspect Rome.' }] }], providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }), tools: [foundCityTool()], toolChoice: { type: 'auto' },
    };
    const frame = (delta: Record<string, unknown>, finishReason: string | null = null) => ({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini', choices: [{ index: 0, delta, finish_reason: finishReason }] });
    const call = (id: string, name: string) => ({ index: id === 'a' ? 0 : 1, id, type: 'function', function: { name, arguments: '{}' } });
    const result = (id: string, name: string, status: string) => ({ id, type: 'function', function: { name, arguments: '{}' }, result: { status } });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(streamingCompletion(
      frame({ tool_calls: [call('a', 'web_search'), call('b', 'computer_use')] }),
      frame({ tool_results: [result('b', 'computer_use', 'in_progress'), result('a', 'web_search', 'in_progress')] }),
      frame({ tool_results: [result('a', 'web_search', 'completed'), result('b', 'computer_use', 'completed')] }),
      { ...frame({}, 'stop'), usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    )).mockResolvedValueOnce(streamingCompletion(
      frame({ tool_results: [result('orphan', 'web_search', 'completed')] }),
      { ...frame({}, 'stop'), usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    )).mockResolvedValueOnce(streamingCompletion(
      frame({ tool_calls: [call('duplicate', 'web_search')] }),
      frame({ tool_results: [result('duplicate', 'web_search', 'completed')] }),
      frame({ tool_results: [result('duplicate', 'web_search', 'completed')] }),
    )).mockResolvedValueOnce(streamingCompletion(
      frame({ tool_calls: [call('disconnect', 'web_search')] }),
    )).mockResolvedValueOnce(streamingCompletion(
      frame({ tool_calls: [call('completed-disconnect', 'web_search')] }),
      frame({ tool_results: [result('completed-disconnect', 'web_search', 'completed')] }),
    )));

    const interleaved = await streamParts(model, params);
    expect(interleaved.filter((part) => part.type === 'tool-call' && ['a', 'b'].includes(part.toolCallId))).toHaveLength(2);
    await expect(streamParts(model, params)).rejects.toMatchObject({ name: 'CodexProviderProtocolError', isRetryable: false });
    await expect(streamParts(model, params)).rejects.toMatchObject({ name: 'CodexProviderProtocolError', isRetryable: false });
    await expect(streamParts(model, params)).rejects.toMatchObject({ name: 'CodexProviderProtocolError', isRetryable: false });
    await expect(streamParts(model, params)).rejects.toMatchObject({ name: 'CodexProviderProtocolError', isRetryable: false });
  });

  it('forwards caller-requested raw chunks before their normalized activity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamingCompletion(
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'search-raw', type: 'function', function: { name: 'web_search', arguments: '{"query":"Rome"}' } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: { tool_results: [{ id: 'search-raw', type: 'function', function: { name: 'web_search', arguments: '{"query":"Rome"}' }, result: { status: 'completed' } }] }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-5.4-mini',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const model = buildCodexModel({ provider: 'codex', name: 'gpt-5.4-mini' });
    const parts = await streamParts(model, {
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello.' }] }],
      providerOptions: buildCodexProviderOptions({ provider: 'codex', name: 'gpt-5.4-mini' }),
      includeRawChunks: true,
    });

    const firstRaw = parts.findIndex((part) => part.type === 'raw');
    const activityCall = parts.findIndex((part) => part.type === 'tool-call' && part.toolCallId === 'search-raw');
    expect(firstRaw).toBeGreaterThanOrEqual(0);
    expect(firstRaw).toBeLessThan(activityCall);
  });

  it('suppresses internally enabled raw chunks when transformed parameters are cloned', async () => {
    const middleware = codexActivityMiddleware();
    const transformed = await middleware.transformParams!({
      type: 'stream',
      params: {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello.' }] }],
        includeRawChunks: false,
      } as any,
      model: {} as any,
    });
    const wrapped = await middleware.wrapStream!({
      doGenerate: async () => { throw new Error('not used'); },
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'raw', rawValue: { choices: [{ delta: {}, finish_reason: null }] } });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
            });
            controller.close();
          },
        }),
      } as any),
      params: { ...transformed },
      model: {} as any,
    });
    const parts: any[] = [];
    for await (const part of wrapped.stream) parts.push(part);

    expect(parts.some((part) => part.type === 'raw')).toBe(false);
    expect(parts.some((part) => part.type === 'finish')).toBe(true);
  });
});
