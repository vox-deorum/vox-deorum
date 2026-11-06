/**
 * Tests for the `claude-code` provider branch of getModel/getModelConfig.
 *
 * This is the first per-provider unit test for `models.ts`. We mock the
 * `ai-sdk-provider-claude-code` package (both exports) so the factory returns a
 * MockLanguageModelV4 the middleware tail can wrap, and capture the settings the
 * factory receives to assert how the claude-code case translates model config.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';

// Hoisted holder so the (hoisted) vi.mock factory can record the captured settings and
// expose the created model instance (for reading transformed generate params via its
// built-in doGenerateCalls recorder).
const mocks = vi.hoisted(() => ({
  captured: undefined as any,
  model: undefined as any,
  queryMessages: undefined as any[] | undefined,
}));

vi.mock('ai-sdk-provider-claude-code', () => {
  const factory = vi.fn((_id: string, settings: any) => {
    mocks.captured = settings;
    mocks.model = new MockLanguageModelV4({
      doGenerate: async (options: any) => {
        // Simulate the provider's structured-output path, where it consumes raw SDK
        // messages before deciding whether a JSON response was produced.
        if (mocks.queryMessages && options.responseFormat?.type === 'json') {
          const sdkMessages: any = (async function* () {
            for (const message of mocks.queryMessages!) yield message;
          })();
          const query: any = {
            next: sdkMessages.next.bind(sdkMessages),
            return: sdkMessages.return.bind(sdkMessages),
            throw: sdkMessages.throw.bind(sdkMessages),
            // The real Claude Query returns its internal iterator instead of itself.
            [Symbol.asyncIterator]: () => sdkMessages,
          };
          settings.onQueryCreated?.(query);
          try {
            for await (const _message of query) { /* provider consumes the query */ }
          } catch (error) {
            throw error;
          }
          throw new Error('Structured output was requested but no JSON was returned.');
        }
        return {
          content: [{ type: 'text', text: 'ok' }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [],
        } as any;
      },
    });
    return mocks.model;
  });
  return { createClaudeCode: () => factory, claudeCode: factory };
});

import { getModel, getModelConfig, inputTokenLimit, resolveToolFraming } from '../../../src/utils/models/models.js';
import { toolRescueMiddleware } from '../../../src/utils/models/tool-rescue/middleware.js';
import { capabilityHeading, capabilityInstruction } from '../../../src/utils/models/capability-prompt.js';
import { workspaceOutputLimit } from '../../../src/utils/workspace/player-workspace.js';

// The web section is the last section of a web-only capability reminder.
const webGuidance = capabilityInstruction({ web: true })!.split('\n\n').at(-1)!;
import type { Model, ResolvedFilesConfig } from '../../../src/types/index.js';

/** Build a ReadableStream that emits the given chunks then closes (for wrapStream tests). */
function streamFrom(chunks: any[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** Joins the text of every user message, which is where claude-code receives system content. */
function userText(prompt: any[]): string {
  return prompt
    .filter((m: any) => m.role === 'user')
    .flatMap((m: any) => m.content.map((c: any) => c.text ?? ''))
    .join('\n\n');
}

/** Read every chunk out of a stream into an array. */
async function drain(stream: ReadableStream<any>): Promise<any[]> {
  const out: any[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe('claude-code provider', () => {
  beforeEach(() => {
    mocks.captured = undefined;
    mocks.queryMessages = undefined;
  });

  describe('getModelConfig synthesis', () => {
    it('should synthesize claude-code/sonnet with its concurrency rule', () => {
      expect(getModelConfig('claude-code/sonnet')).toMatchObject({
        provider: 'claude-code',
        name: 'sonnet',
        options: { concurrencyLimit: 1 },
      });
      expect(getModelConfig('claude-code/sonnet').options?.toolMiddleware).toBeUndefined();
    });

    it('should synthesize opus and haiku variants', () => {
      expect(getModelConfig('claude-code/opus')).toMatchObject({ provider: 'claude-code', name: 'opus', options: { concurrencyLimit: 1 } });
      expect(getModelConfig('claude-code/haiku')).toMatchObject({ provider: 'claude-code', name: 'haiku', options: { concurrencyLimit: 1 } });
    });
  });

  describe('getModel settings translation', () => {
    it('fails fast when the removed claudeCodeTools option is present', () => {
      expect(() => getModel({
        provider: 'claude-code',
        name: 'sonnet',
        options: { claudeCodeTools: ['Read'] },
      })).toThrow('The `claudeCodeTools` option was renamed to `hostTools`');
    });

    it('rejects prompt-mode and gemma tool middleware, because tools are native', () => {
      for (const toolMiddleware of ['prompt', 'gemma'] as const) {
        expect(() => getModel({ provider: 'claude-code', name: 'sonnet', options: { toolMiddleware } })).toThrow();
      }
    });

    it('rejects a raw usage-limit notice before structured-output validation', async () => {
      const notice = "You've hit your weekly limit · resets Jul 14, 10pm (America/Phoenix)";
      mocks.queryMessages = [{
        type: 'assistant',
        message: { content: [{ type: 'text', text: notice }] },
      }];
      const model = getModel({ provider: 'claude-code', name: 'sonnet' });

      await expect((model as any).doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        providerOptions: {},
        responseFormat: { type: 'json', schema: { type: 'object' } },
      })).rejects.toMatchObject({
        message: notice,
        isRetryable: true,
        retryAt: expect.any(Number),
      });
    });

    it('should isolate filesystem settings and disable all built-in tools', () => {
      getModel({ provider: 'claude-code', name: 'sonnet' });
      expect(mocks.captured).toBeDefined();
      expect(mocks.captured.settingSources).toEqual([]);
      expect(mocks.captured.tools).toEqual([]);
    });

    it('should unset ANTHROPIC_API_KEY so the CLI uses the subscription login', () => {
      getModel({ provider: 'claude-code', name: 'sonnet' });
      expect(mocks.captured.env).toHaveProperty('ANTHROPIC_API_KEY', undefined);
    });

    it('should map a non-minimal reasoningEffort to effort with summarized adaptive thinking', () => {
      getModel({ provider: 'claude-code', name: 'opus', options: { reasoningEffort: 'high' } });
      expect(mocks.captured.effort).toBe('high');
      expect(mocks.captured.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    });

    it('should map a minimal reasoningEffort to disabled thinking with no effort', () => {
      getModel({ provider: 'claude-code', name: 'sonnet', options: { reasoningEffort: 'minimal' } });
      expect(mocks.captured.thinking).toEqual({ type: 'disabled' });
      expect(mocks.captured.effort).toBeUndefined();
    });

    it('should omit effort and thinking when no reasoningEffort is configured', () => {
      getModel({ provider: 'claude-code', name: 'haiku' });
      expect(mocks.captured.effort).toBeUndefined();
      expect(mocks.captured.thinking).toBeUndefined();
    });
  });

  describe('getModel built-in CLI tools (Stage 2)', () => {
    it("expands ['Web'] to the web tools with bare permissions and no cwd", () => {
      getModel({ provider: 'claude-code', name: 'sonnet', options: { hostTools: ['Web'] } });
      // Availability: the Web tools plus TodoWrite bookkeeping, never a file tool.
      expect(mocks.captured.tools).toEqual(['WebFetch', 'WebSearch', 'TodoWrite']);
      // Permission: the allowlist mirrors the tool list with no path scoping.
      expect(mocks.captured.allowedTools).toEqual(mocks.captured.tools);
      // disallowedTools is deliberately unset: the provider ignores it whenever
      // allowedTools is present (and warns if both are supplied).
      expect(mocks.captured.disallowedTools).toBeUndefined();
      expect(mocks.captured.permissionMode).toBe('dontAsk');
      // No working directory: Claude Code no longer touches the filesystem.
      expect(mocks.captured.cwd).toBeUndefined();
    });

    it('fails fast on entries outside the Web whitelist', () => {
      for (const hostTools of [['Read'], ['Write'], ['everything'], ['Bash'], ['Web', 'Read']]) {
        expect(() => getModel(
          { provider: 'claude-code', name: 'sonnet', options: { hostTools } } as any,
        )).toThrow('Unsupported hostTools entries');
      }
    });

    it('stays pure text (tools: []) with no cwd/permission settings when no built-in tools requested', () => {
      getModel({ provider: 'claude-code', name: 'sonnet' });
      expect(mocks.captured.tools).toEqual([]);
      expect(mocks.captured.cwd).toBeUndefined();
      expect(mocks.captured.permissionMode).toBeUndefined();
      expect(mocks.captured.allowedTools).toBeUndefined();
    });
  });

  describe('native tools through the run session', () => {
    const tools = [
      {
        type: 'function',
        name: 'send_message',
        description: 'Send a message',
        inputSchema: { type: 'object', properties: { messageText: { type: 'string', description: 'Controlled message field' } }, required: ['messageText'], additionalProperties: false },
      },
      { type: 'function', name: 'finalize_decision', description: 'Finish this turn', inputSchema: { type: 'object', properties: {} } },
      { type: 'function', name: 'bash', description: 'Run a script', inputSchema: { type: 'object', properties: {} } },
    ];
    const patch = () => ({
      mcpServers: { vox: { type: 'sdk', name: 'vox', instance: {} } },
      mcpToolNames: ['mcp__vox__send_message'],
      env: { MCP_TOOL_TIMEOUT: '60000' },
      persistSession: false,
      onQuery: vi.fn(),
      preserveUsageLimitError: vi.fn(),
    });

    /** A stand-in run session that records each step and answers with an empty stop. */
    function stubSession() {
      const calls: Array<{ params: any; options: any }> = [];
      const session = {
        stream: async (params: any, options: any) => {
          calls.push({ params, options });
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({
                  type: 'finish',
                  finishReason: { unified: 'stop', raw: 'stop' },
                  usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
                });
                controller.close();
              },
            }),
          };
        },
        close: async () => {},
      };
      return { calls, session: session as any };
    }

    /** Read a stream to its end. */
    async function drain(stream: ReadableStream<any>): Promise<any[]> {
      const parts: any[] = [];
      const reader = stream.getReader();
      for (let read = await reader.read(); !read.done; read = await reader.read()) parts.push(read.value);
      return parts;
    }

    it('streams tool requests through the run session with system text demoted and the tools left native', async () => {
      const { calls, session } = stubSession();
      const files: ResolvedFilesConfig = { game: 'write', shared: {}, quota: 7 };
      const model = getModel(
        { provider: 'claude-code', name: 'sonnet', options: { hostTools: ['Web'] } },
        { files, completionTools: ['finalize_decision', 'inactive_action'], claudeCodeSession: session },
      );
      const prompt: any = [
        { role: 'system', content: 'You are the strategist.' },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ];
      const originalPrompt = structuredClone(prompt);
      const { stream } = await (model as any).doStream({ tools, toolChoice: { type: 'required' }, prompt, providerOptions: {} });
      await drain(stream);

      expect(calls).toHaveLength(1);
      const sent = calls[0].params;
      expect(sent.prompt.some((message: any) => message.role === 'system')).toBe(false);
      const text = userText(sent.prompt);
      expect(text).toContain('You are the strategist.');
      expect(text).toContain(webGuidance);
      expect(text).toContain(workspaceOutputLimit.toLocaleString('en-US'));
      expect(text).toContain('finalize_decision');
      expect(text).not.toContain('inactive_action');
      // Tools travel as declarations, never as a prompt-mode schema in the text.
      expect(text).not.toContain('messageText');
      expect(sent.tools.map((tool: any) => tool.name)).toEqual(tools.map((tool) => tool.name));
      expect(sent.toolChoice).toEqual({ type: 'auto' });
      expect(calls[0].options.hostTools).toEqual(['WebFetch', 'WebSearch', 'TodoWrite']);
      expect(prompt).toEqual(originalPrompt);
    });

    it('keeps the session key stable for one configuration and different for another', async () => {
      const { calls, session } = stubSession();
      const request = { tools, toolChoice: { type: 'auto' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], providerOptions: {} };
      for (const name of ['sonnet', 'sonnet', 'opus']) {
        const model = getModel({ provider: 'claude-code', name }, { claudeCodeSession: session });
        await drain((await (model as any).doStream(request)).stream);
      }
      expect(calls[0].options.key).toBe(calls[1].options.key);
      expect(calls[2].options.key).not.toBe(calls[0].options.key);
    });

    it('gives the CLI no built-in tools beyond the host tools, and allows the session tools', async () => {
      for (const [hostTools, builtIn] of [[undefined, []], [['Web'], ['WebFetch', 'WebSearch', 'TodoWrite']]] as const) {
        const { calls, session } = stubSession();
        const model = getModel({ provider: 'claude-code', name: 'sonnet', options: { hostTools: hostTools as any } }, { claudeCodeSession: session });
        await drain((await (model as any).doStream({ tools, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], providerOptions: {} })).stream);
        calls[0].options.open(patch());
        expect(mocks.captured.tools).toEqual(builtIn);
        expect(mocks.captured.allowedTools).toEqual([...builtIn, 'mcp__vox__send_message']);
        expect(mocks.captured.permissionMode).toBe('dontAsk');
        expect(Object.keys(mocks.captured.mcpServers)).toEqual(['vox']);
        expect(mocks.captured.settingSources).toEqual([]);
        expect(mocks.captured.env).toHaveProperty('ANTHROPIC_API_KEY', undefined);
        expect(mocks.captured.env.MCP_TOOL_TIMEOUT).toBe('60000');
      }
    });

    it('keeps the usage-limit guard on session queries and hands the query to the session', async () => {
      const { calls, session } = stubSession();
      const model = getModel({ provider: 'claude-code', name: 'sonnet' }, { claudeCodeSession: session });
      await drain((await (model as any).doStream({ tools, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], providerOptions: {} })).stream);
      const sessionPatch = patch();
      calls[0].options.open(sessionPatch);

      const notice = "You've hit your session limit · resets 3pm";
      const messages: any = (async function* () {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: notice }] } };
      })();
      const query: any = { [Symbol.asyncIterator]: () => messages };
      mocks.captured.onQueryCreated(query);
      expect(sessionPatch.onQuery).toHaveBeenCalledWith(query);
      await expect((async () => { for await (const _message of query) { /* consume */ } })()).rejects.toMatchObject({ message: notice });
      expect(sessionPatch.preserveUsageLimitError).toHaveBeenCalled();
    });

    it('sends requests without tools straight to the provider', async () => {
      const { calls, session } = stubSession();
      const model = getModel({ provider: 'claude-code', name: 'sonnet' }, { claudeCodeSession: session });
      await (model as any).doGenerate({
        prompt: [
          { role: 'system', content: 'Answer briefly.' },
          { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        ],
        providerOptions: {},
      });
      expect(calls).toHaveLength(0);
      const sent = mocks.model.doGenerateCalls.at(-1).prompt;
      expect(sent.some((message: any) => message.role === 'system')).toBe(false);
      expect(userText(sent)).toContain('Answer briefly.');
    });

    it('answers a request whose tool choice is none without exposing its tools', async () => {
      const { calls, session } = stubSession();
      const model = getModel({ provider: 'claude-code', name: 'sonnet' }, { claudeCodeSession: session });
      await (model as any).doGenerate({
        tools,
        toolChoice: { type: 'none' },
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        providerOptions: {},
      });
      expect(calls).toHaveLength(0);
      expect(mocks.model.doGenerateCalls.at(-1).tools).toBeUndefined();
    });

    it('refuses a non-streaming tool request', async () => {
      const model = getModel({ provider: 'claude-code', name: 'sonnet' });
      await expect((model as any).doGenerate({
        tools,
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        providerOptions: {},
      })).rejects.toThrow();
    });
  });

  describe('tool-rescue action framing (Stage 2)', () => {
    const tools = [
      {
        type: 'function',
        name: 'send_message',
        description: 'Send a message',
        inputSchema: { type: 'object', properties: { messageText: { type: 'string', description: 'Controlled message field' } }, required: ['messageText'], additionalProperties: false },
      },
    ];

    it("injects Action headings and the \"action\" JSON key when framing is 'action'", async () => {
      const mw = toolRescueMiddleware({ prompt: true, framing: 'action' });
      const out: any = await (mw.transformParams as any)({
        params: { tools, toolChoice: { type: 'auto' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      });
      expect(out.prompt[0].role).toBe('system');
      const sys = out.prompt[0].content as string;
      expect(sys).toContain('## Action Calling');
      expect(sys).toContain('## Available Actions');
      expect(sys).toContain('{ "action": "<action_name>", "arguments": { <parameters> } }');
      expect(sys).not.toContain('## Tool Calling');
    });

    it('keeps the default Tool framing when framing is unset', async () => {
      const mw = toolRescueMiddleware({ prompt: true });
      const out: any = await (mw.transformParams as any)({
        params: { tools, toolChoice: { type: 'auto' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      });
      const sys = out.prompt[0].content as string;
      expect(sys).toContain('## Tool Calling');
      expect(sys).toContain('{ "tool": "<tool_name>", "arguments": { <parameters> } }');
      expect(sys).not.toContain('Action');
    });

    it('rewrites prior native tool-call/tool-result history to the action framing', async () => {
      const mw = toolRescueMiddleware({ prompt: true, framing: 'action' });
      const out: any = await (mw.transformParams as any)({
        params: {
          tools,
          toolChoice: { type: 'auto' },
          prompt: [
            { role: 'user', content: [{ type: 'text', text: 'go' }] },
            { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'send_message', input: { text: 'hello' } }] },
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'send_message', output: { type: 'text', value: 'delivered' } }] },
          ],
        },
      });
      // Flatten every text part across the converted prompt.
      const allText = out.prompt
        .flatMap((m: any) => Array.isArray(m.content) ? m.content : [])
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('\n');
      expect(allText).toContain('"action": "send_message"');
      expect(allText).toContain('# Action send_message Result');
      expect(allText).not.toContain('"tool": "send_message"');
      expect(allText).not.toContain('# Tool send_message Result');
    });

    it('rewords agent-authored system prose to action wording under action framing', async () => {
      const mw = toolRescueMiddleware({ prompt: true, framing: 'action' });
      const out: any = await (mw.transformParams as any)({
        params: {
          tools,
          toolChoice: { type: 'auto' },
          prompt: [
            { role: 'system', content: 'Use the `send_message` tool. See the Available Tools list.' },
            { role: 'user', content: [{ type: 'text', text: 'hi' }] },
          ],
        },
      });
      const joined = out.prompt.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
      expect(joined).toContain('Use the `send_message` action. See the Available Actions list.');
      expect(joined).not.toContain('`send_message` tool');
    });

    it('reports action framing via onToolFraming', async () => {
      let info: { framing: string } | undefined;
      const mw = toolRescueMiddleware({ prompt: true, framing: 'action', onToolFraming: (i) => { info = i; } });
      await (mw.transformParams as any)({
        params: { tools, toolChoice: { type: 'auto' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      });
      // Only the resolved framing fact is reported; the injected prompt itself is never stored.
      expect(info).toEqual({ framing: 'action' });
    });

    it("reports 'tool' framing via onToolFraming under the default framing", async () => {
      let info: { framing: string } | undefined;
      const mw = toolRescueMiddleware({ prompt: true, onToolFraming: (i) => { info = i; } });
      await (mw.transformParams as any)({
        params: { tools, toolChoice: { type: 'auto' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      });
      expect(info).toEqual({ framing: 'tool' });
    });

    it('inserts the action protocol block right before the first user message', async () => {
      const mw = toolRescueMiddleware({ prompt: true, framing: 'action' });
      const out: any = await (mw.transformParams as any)({
        params: {
          tools,
          toolChoice: { type: 'auto' },
          prompt: [
            { role: 'system', content: 'You are a diplomat.' },
            { role: 'user', content: [{ type: 'text', text: 'hi' }] },
          ],
        },
      });
      // Leading agent-authored system prose stays first; the protocol block is the system
      // message immediately preceding the first user message.
      expect(out.prompt.map((m: any) => m.role)).toEqual(['system', 'system', 'user']);
      expect(out.prompt[0].content).toContain('You are a diplomat.');
      expect(out.prompt[1].content).toContain('## Action Calling');
    });

    // A prompt-mode model writes its tool call as JSON text, so without this the spoken reply is
    // invisible until the JSON closes and then lands in one piece. wrapStream forwards a
    // whitelisted tool's arguments as synthetic tool-input chunks while they accumulate.
    describe('synthetic tool-input streaming', () => {
      const streamTools = [
        {
          type: 'function',
          name: 'send-message',
          description: 'Speak to the counterpart',
          inputSchema: { type: 'object', properties: { Message: { type: 'string' } }, additionalProperties: false },
        },
        {
          type: 'function',
          name: 'get-briefing',
          description: 'Read a briefing',
          inputSchema: { type: 'object', properties: { Turn: { type: 'number' } }, additionalProperties: false },
        },
      ];

      /** Same transformParams round-trip as the carrier suite, for a middleware under test. */
      async function transformedFor(mw: any) {
        return await (mw.transformParams as any)({
          params: { tools: streamTools, toolChoice: { type: 'required' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
        });
      }

      /** Feed text deltas for one block through wrapStream and return every emitted chunk. */
      async function runBlock(mw: any, deltas: string[], options?: { endBlock?: boolean }) {
        const chunks: any[] = [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          ...deltas.map((delta) => ({ type: 'text-delta', id: 't1', delta })),
        ];
        if (options?.endBlock !== false) chunks.push({ type: 'text-end', id: 't1' });
        chunks.push({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } });
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformedFor(mw) });
        return await drain(stream);
      }

      const byType = (out: any[], type: string) => out.filter((c: any) => c.type === type);

      // `"Hello there"` split so the name, the arguments brace, and the value all straddle deltas.
      const splitCall = ['[{"tool":"send-', 'message","arguments":{"Mes', 'sage":"Hello ', 'there"}', '}]'];

      it('streams a whitelisted tool argument as it accumulates', async () => {
        const mw = toolRescueMiddleware({ prompt: true });
        const out = await runBlock(mw, splitCall);

        const starts = byType(out, 'tool-input-start');
        const deltas = byType(out, 'tool-input-delta');
        const ends = byType(out, 'tool-input-end');
        const calls = byType(out, 'tool-call');
        expect(starts).toHaveLength(1);
        expect(starts[0].toolName).toBe('send-message');
        expect(deltas.length).toBeGreaterThanOrEqual(2);
        expect(ends).toHaveLength(1);
        expect(calls).toHaveLength(1);

        // The deltas are the tool's own input verbatim, so they reconstruct what was committed.
        const streamed = deltas.map((c: any) => c.delta).join('');
        expect(JSON.parse(streamed)).toEqual(JSON.parse(calls[0].input));
        expect(JSON.parse(calls[0].input)).toEqual({ Message: 'Hello there' });
      });

      it('binds the committed call to the id its arguments streamed under', async () => {
        // The load-bearing invariant: downstream matches the terminal call back to its open delta
        // stream by this id, and on a miss re-speaks the whole message as a second bubble.
        const mw = toolRescueMiddleware({ prompt: true });
        const out = await runBlock(mw, splitCall);
        const start = byType(out, 'tool-input-start')[0];
        const call = byType(out, 'tool-call')[0];
        expect(call.toolCallId).toBe(start.id);
        for (const delta of byType(out, 'tool-input-delta')) expect(delta.id).toBe(start.id);
        expect(byType(out, 'tool-input-end')[0].id).toBe(start.id);
      });

      it('closes the input stream before the call it belongs to', async () => {
        // A delta emitted after its own tool-call would find no open stream downstream and leak
        // the raw JSON fragment onward as an unknown chunk.
        const mw = toolRescueMiddleware({ prompt: true });
        const out = await runBlock(mw, splitCall);
        const types = out.map((c: any) => c.type);
        expect(types.lastIndexOf('tool-input-delta')).toBeLessThan(types.indexOf('tool-input-end'));
        expect(types.indexOf('tool-input-end')).toBeLessThan(types.indexOf('tool-call'));
      });

      it('normalizes a miscased argument key on the committed call while still streaming it', async () => {
        const mw = toolRescueMiddleware({ prompt: true });
        const out = await runBlock(mw, ['[{"tool":"send-message","arguments":{"mess', 'age":"lowercase"}}]']);
        expect(byType(out, 'tool-input-start')).toHaveLength(1);
        const calls = byType(out, 'tool-call');
        expect(calls).toHaveLength(1);
        expect(JSON.parse(calls[0].input)).toEqual({ Message: 'lowercase' });
      });

      it('stays off for a native tool-calling model, which streams its own tool input', async () => {
        const mw = toolRescueMiddleware();
        const out = await runBlock(mw, splitCall);
        expect(byType(out, 'tool-input-start')).toHaveLength(0);
        expect(byType(out, 'tool-input-delta')).toHaveLength(0);
        expect(byType(out, 'tool-call')).toHaveLength(1);
      });

      it('leaves a tool outside the whitelist unstreamed', async () => {
        const mw = toolRescueMiddleware({ prompt: true });
        const out = await runBlock(mw, ['[{"tool":"get-brie', 'fing","arguments":{"Turn":4}}]']);
        expect(byType(out, 'tool-input-start')).toHaveLength(0);
        expect(byType(out, 'tool-input-delta')).toHaveLength(0);
        expect(byType(out, 'tool-call')).toHaveLength(1);
      });

      it('closes an opened stream when the response ends without committing a call', async () => {
        // Truncated response: the block never ends, so its buffer is never rescued. The stream must
        // still be closed rather than left open past the response that opened it.
        const mw = toolRescueMiddleware({ prompt: true });
        const out = await runBlock(mw, ['[{"tool":"send-message","arguments":{"Message":"Hal'], { endBlock: false });
        expect(byType(out, 'tool-input-start')).toHaveLength(1);
        expect(byType(out, 'tool-input-delta').length).toBeGreaterThanOrEqual(1);
        expect(byType(out, 'tool-input-end')).toHaveLength(1);
        expect(byType(out, 'tool-call')).toHaveLength(0);
      });

      it('streams a fenced contour, whose call only commits at text-end', async () => {
        const mw = toolRescueMiddleware({ prompt: true });
        const out = await runBlock(mw, [
          '```json\n[{"tool":"send-message","arguments":{"Mes',
          'sage":"Fenced"}}]\n```',
        ]);
        expect(byType(out, 'tool-input-start')).toHaveLength(1);
        const calls = byType(out, 'tool-call');
        expect(calls).toHaveLength(1);
        expect(JSON.parse(calls[0].input)).toEqual({ Message: 'Fenced' });
        expect(calls[0].toolCallId).toBe(byType(out, 'tool-input-start')[0].id);
      });

      it('gives each streamed call in one array its own id, never a shared one', async () => {
        const mw = toolRescueMiddleware({ prompt: true });
        const out = await runBlock(mw, [
          '[{"tool":"send-message","arguments":{"Message":"one"}},',
          '{"tool":"send-message","arguments":{"Message":"two"}}]',
        ]);
        const starts = byType(out, 'tool-input-start');
        const calls = byType(out, 'tool-call');
        expect(calls).toHaveLength(2);
        expect(new Set(starts.map((c: any) => c.id)).size).toBe(starts.length);
        // Every stream that opened was claimed by a call, so nothing is left to re-speak whole.
        const callIds = new Set(calls.map((c: any) => c.toolCallId));
        for (const start of starts) expect(callIds.has(start.id)).toBe(true);
      });

      it('binds the streamed id to the call it streamed, not an earlier flattened one', async () => {
        // The flattened contour has no arguments object, so only the SECOND call can stream — but
        // the rescue commits both, in source order. Pairing the halves by tool name alone would
        // hand the streamed "second" text to the "first" call: the live bubble would drop "first"
        // entirely and speak "second" twice, while the persisted reply held both.
        const mw = toolRescueMiddleware({ prompt: true });
        const out = await runBlock(mw, [
          '```json\n[{"action":"send-message","Message":"first"},'
            + '{"action":"send-message","arguments":{"Mes',
          'sage":"second"}}]\n```',
        ]);
        const starts = byType(out, 'tool-input-start');
        const calls = byType(out, 'tool-call');
        expect(starts).toHaveLength(1);
        expect(calls.map((c: any) => JSON.parse(c.input).Message)).toEqual(['first', 'second']);

        // What streamed was "second", so the call wearing that id must be "second".
        const streamed = byType(out, 'tool-input-delta').map((c: any) => c.delta).join('');
        expect(JSON.parse(streamed)).toEqual({ Message: 'second' });
        const bound = calls.filter((c: any) => c.toolCallId === starts[0].id);
        expect(bound).toHaveLength(1);
        expect(JSON.parse(bound[0].input)).toEqual({ Message: 'second' });
      });

      it('re-counts the calls ahead of it when a mid-stream rescue consumes them', async () => {
        // Same shape, unfenced: the strict mid-stream parse commits "first" out of the buffer while
        // "second" is still streaming. The parked stream must then expect ONE fewer call ahead of
        // it, or the text-end rescue — which sees only "second" — would leave it unbound and the
        // message would be spoken a second time as its own bubble.
        const mw = toolRescueMiddleware({ prompt: true });
        const out = await runBlock(mw, [
          '[{"action":"send-message","Message":"first"},'
            + '{"action":"send-message","arguments":{"Mes',
          'sage":"second"}}]',
        ]);
        const starts = byType(out, 'tool-input-start');
        const calls = byType(out, 'tool-call');
        expect(starts).toHaveLength(1);
        expect(calls.map((c: any) => JSON.parse(c.input).Message)).toEqual(['first', 'second']);
        const bound = calls.filter((c: any) => c.toolCallId === starts[0].id);
        expect(bound).toHaveLength(1);
        expect(JSON.parse(bound[0].input)).toEqual({ Message: 'second' });
      });
    });
  });
});

describe('resolveToolFraming', () => {
  it("returns 'tool' by default for every provider, claude-code included", () => {
    expect(resolveToolFraming({ provider: 'claude-code', name: 'sonnet' })).toBe('tool');
    expect(resolveToolFraming({ provider: 'claude-code', name: 'sonnet', options: { hostTools: ['Web'] } })).toBe('tool');
    expect(resolveToolFraming({ provider: 'openrouter', name: 'x' })).toBe('tool');
  });

  it('honors an explicit options.framing override regardless of provider (Oracle replay)', () => {
    expect(resolveToolFraming({ provider: 'openrouter', name: 'x', options: { framing: 'action' } })).toBe('action');
    expect(resolveToolFraming({ provider: 'claude-code', name: 'sonnet', options: { framing: 'action' } })).toBe('action');
  });
});

describe('typesafe provider', () => {
  it('should reject a chat model request for the evaluation-only provider', () => {
    // Explicit rejection, not the openai-compatible default: a typesafe chat
    // agent would silently hit OPENAI_COMPATIBLE_URL with a bogus model name.
    expect(() => getModel({ provider: 'typesafe', name: 'jev-latest' }))
      .toThrow('Provider \'typesafe\' serves evaluation models only and cannot back a chat agent');
  });
});

describe('inputTokenLimit', () => {
  /** A model config shaped for input limit resolution, with an optional explicit limit. */
  function modelConfig(provider: string, name: string, maxInputTokens?: unknown): Model {
    const options: Record<string, any> | undefined =
      maxInputTokens === undefined ? undefined : { maxInputTokens };
    return { provider, name, options } as Model;
  }

  it('should give the TypeSafe default and leave unlimited providers undefined', () => {
    // Jev rejects state over its 32k cap, so an unlimited typesafe model would fail every call.
    expect(inputTokenLimit(modelConfig('typesafe', 'jev-latest'))).toBe(30_000);
    expect(inputTokenLimit(modelConfig('openai', 'gpt-x'))).toBeUndefined();
    expect(inputTokenLimit(modelConfig('openrouter', 'qwen/qwen3'))).toBeUndefined();
  });

  it('should honor an explicit limit over the provider default', () => {
    expect(inputTokenLimit(modelConfig('typesafe', 'jev-latest', 12_000))).toBe(12_000);
    expect(inputTokenLimit(modelConfig('openai', 'gpt-x', 12_000))).toBe(12_000);
  });

  it('should fall back to the provider default for non-positive, non-finite, or non-numeric values', () => {
    for (const value of [0, -1, NaN, Infinity, '5000']) {
      expect(inputTokenLimit(modelConfig('typesafe', 'jev-latest', value))).toBe(30_000);
      expect(inputTokenLimit(modelConfig('openai', 'gpt-x', value))).toBeUndefined();
    }
  });
});

