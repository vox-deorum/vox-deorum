/**
 * Tests for the `claude-code` provider branch of getModel/getModelConfig.
 *
 * This is the first per-provider unit test for `models.ts`. We mock the
 * `ai-sdk-provider-claude-code` package (both exports) so the factory returns a
 * MockLanguageModelV3 the middleware tail can wrap, and capture the settings the
 * factory receives to assert how the claude-code case translates model config.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

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
    mocks.model = new MockLanguageModelV3({
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
            const providerError = new Error((error as Error).message) as Error & { isRetryable: false };
            providerError.isRetryable = false;
            throw providerError;
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

import { getModel, getModelConfig, resolveToolFraming } from '../../../src/utils/models/models.js';
import { toolRescueMiddleware } from '../../../src/utils/models/tool-rescue/middleware.js';

/** Build a ReadableStream that emits the given chunks then closes (for wrapStream tests). */
function streamFrom(chunks: any[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
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

// The vetted safe set that claude-code's ['everything'] expands to (mirrors models.ts).
const SAFE_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Write', 'Edit', 'TodoWrite'];

describe('claude-code provider', () => {
  beforeEach(() => {
    mocks.captured = undefined;
    mocks.queryMessages = undefined;
  });

  describe('getModelConfig registration', () => {
    it('should resolve claude-code/sonnet to the registered default entry', () => {
      // The registered entry carries empty options: prompt-mode tool calling is forced
      // unconditionally in getModel's 'claude-code' case (claude-code has no native tool calling),
      // so it is NOT stored on the config (see config/defaults.ts).
      expect(getModelConfig('claude-code/sonnet')).toMatchObject({
        provider: 'claude-code',
        name: 'sonnet',
      });
      expect(getModelConfig('claude-code/sonnet').options?.toolMiddleware).toBeUndefined();
    });

    it('should register opus and haiku variants', () => {
      expect(getModelConfig('claude-code/opus')).toMatchObject({ provider: 'claude-code', name: 'opus' });
      expect(getModelConfig('claude-code/haiku')).toMatchObject({ provider: 'claude-code', name: 'haiku' });
    });
  });

  describe('getModel settings translation', () => {
    it('rejects a raw usage-limit notice before required-tool structured validation', async () => {
      const notice = "You've hit your weekly limit · resets Jul 14, 10pm (America/Phoenix)";
      mocks.queryMessages = [{
        type: 'assistant',
        message: { content: [{ type: 'text', text: notice }] },
      }];
      const model = getModel({ provider: 'claude-code', name: 'sonnet' });
      const tools = [{
        type: 'function',
        name: 'send_message',
        description: 'Send a message',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }];

      await expect((model as any).doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        providerOptions: {},
        tools,
        toolChoice: { type: 'required' },
      })).rejects.toMatchObject({
        message: notice,
        isRetryable: false,
      });
      expect(mocks.model.doGenerateCalls[0].responseFormat).toMatchObject({ type: 'json' });
    });

    it('should isolate filesystem settings and disable all built-in tools', () => {
      getModel({ provider: 'claude-code', name: 'sonnet', options: { toolMiddleware: 'prompt' } });
      expect(mocks.captured).toBeDefined();
      expect(mocks.captured.settingSources).toEqual([]);
      expect(mocks.captured.tools).toEqual([]);
    });

    it('should map a non-minimal reasoningEffort to effort with summarized adaptive thinking', () => {
      getModel({
        provider: 'claude-code',
        name: 'opus',
        options: { toolMiddleware: 'prompt', reasoningEffort: 'high' }
      });
      expect(mocks.captured.effort).toBe('high');
      expect(mocks.captured.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    });

    it('should map a minimal reasoningEffort to disabled thinking with no effort', () => {
      getModel({
        provider: 'claude-code',
        name: 'sonnet',
        options: { toolMiddleware: 'prompt', reasoningEffort: 'minimal' }
      });
      expect(mocks.captured.thinking).toEqual({ type: 'disabled' });
      expect(mocks.captured.effort).toBeUndefined();
    });

    it('should omit effort and thinking when no reasoningEffort is configured', () => {
      getModel({ provider: 'claude-code', name: 'haiku', options: { toolMiddleware: 'prompt' } });
      expect(mocks.captured.effort).toBeUndefined();
      expect(mocks.captured.thinking).toBeUndefined();
    });
  });

  describe('getModel built-in CLI tools (Stage 2)', () => {
    const tempRoot = path.join(os.tmpdir(), 'vox-claude-code');
    afterEach(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it("expands ['everything'] to the vetted safe set, path-scopes Write/Edit, blocks Bash, and creates the temp cwd", () => {
      getModel(
        { provider: 'claude-code', name: 'sonnet', options: { toolMiddleware: 'prompt', claudeCodeTools: ['everything'] } },
        { workingDirId: 'g1-3' }
      );
      // Availability: the full vetted set, never Bash.
      expect(mocks.captured.tools).toEqual(SAFE_TOOLS);
      expect(mocks.captured.tools).not.toContain('Bash');
      // Permission: Write/Edit path-scoped to the temp cwd, everything else bare.
      expect(mocks.captured.allowedTools).toEqual([
        'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Write(./**)', 'Edit(./**)', 'TodoWrite',
      ]);
      // disallowedTools is deliberately unset: the provider ignores it whenever
      // allowedTools is present (and warns if both are supplied). Bash stays blocked by
      // its absence from the allowlist under dontAsk deny-by-default.
      expect(mocks.captured.disallowedTools).toBeUndefined();
      expect(mocks.captured.permissionMode).toBe('dontAsk');
      // Temp cwd keyed to the working dir id, created on disk.
      expect(mocks.captured.cwd.endsWith(path.join('vox-claude-code', 'g1-3'))).toBe(true);
      expect(fs.existsSync(mocks.captured.cwd)).toBe(true);
    });

    it('filters Bash out of an explicit whitelist', () => {
      getModel(
        { provider: 'claude-code', name: 'sonnet', options: { toolMiddleware: 'prompt', claudeCodeTools: ['Read', 'Bash'] } },
        { workingDirId: 'g2-1' }
      );
      expect(mocks.captured.tools).toEqual(['Read']);
      expect(mocks.captured.allowedTools).toEqual(['Read']);
    });

    it('stays pure text (tools: []) with no cwd/permission settings when no built-in tools requested', () => {
      getModel({ provider: 'claude-code', name: 'sonnet', options: { toolMiddleware: 'prompt' } });
      expect(mocks.captured.tools).toEqual([]);
      expect(mocks.captured.cwd).toBeUndefined();
      expect(mocks.captured.permissionMode).toBeUndefined();
      expect(mocks.captured.allowedTools).toBeUndefined();
    });
  });

  describe('tool-rescue action framing (Stage 2)', () => {
    const tools = [
      { type: 'function', name: 'send_message', description: 'Send a message', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
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
      expect(info?.framing).toBe('action');
      // Only the resolved framing fact is reported; the injected prompt itself is never stored.
      expect(info).toEqual({ framing: 'action' });
    });

    it('reports only the framing fact under constrained decoding (no prompt payload)', async () => {
      let info: { framing: string } | undefined;
      const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true, onToolFraming: (i) => { info = i; } });
      await (mw.transformParams as any)({
        params: { tools, toolChoice: { type: 'required' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      });
      // Even when structuredToolCalls forces the wrapper transport, the callback still carries
      // the framing fact alone — no prompt content is ever surfaced to telemetry.
      expect(info).toEqual({ framing: 'action' });
    });

    it("reports 'tool' framing via onToolFraming under the default framing", async () => {
      let info: { framing: string } | undefined;
      const mw = toolRescueMiddleware({ prompt: true, onToolFraming: (i) => { info = i; } });
      await (mw.transformParams as any)({
        params: { tools, toolChoice: { type: 'auto' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      });
      expect(info?.framing).toBe('tool');
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
      const firstUserIdx = out.prompt.findIndex((m: any) => m.role === 'user');
      expect(out.prompt[firstUserIdx - 1].content).toContain('## Action Calling');
    });

    it('pins responseFormat to the tool-call array contour for structuredToolCalls + required', async () => {
      const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
      const out: any = await (mw.transformParams as any)({
        params: { tools, toolChoice: { type: 'required' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      });
      expect(out.responseFormat?.type).toBe('json');
      const schema = out.responseFormat.schema;
      // Root is an object wrapping the array (a forced tool call's input_schema must be an object).
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['actions']);
      const item = schema.properties.actions.items;
      expect(item.additionalProperties).toBe(false);
      expect(item.required).toEqual(['action', 'arguments']);
      expect(item.properties.action.enum).toEqual(['send_message']);
      expect(item.properties.arguments).toEqual({ type: 'object' });
    });

    it('does not set responseFormat for a non-required tool choice', async () => {
      const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
      const out: any = await (mw.transformParams as any)({
        params: { tools, toolChoice: { type: 'auto' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      });
      expect(out.responseFormat).toBeUndefined();
    });

    it('does not set responseFormat when structuredToolCalls is disabled', async () => {
      const mw = toolRescueMiddleware({ prompt: true, framing: 'action' });
      const out: any = await (mw.transformParams as any)({
        params: { tools, toolChoice: { type: 'required' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      });
      expect(out.responseFormat).toBeUndefined();
    });

    it('never clobbers a responseFormat a real output schema already set', async () => {
      const existing = { type: 'json', schema: { type: 'object' } };
      const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
      const out: any = await (mw.transformParams as any)({
        params: { tools, toolChoice: { type: 'required' }, responseFormat: existing, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      });
      expect(out.responseFormat).toBe(existing);
    });

    describe('StructuredOutput carrier capture-back', () => {
      // Real game tools are hyphenated; the carrier emits the same hyphenated action name.
      const gameTools = [
        { type: 'function', name: 'send-message', description: 'Send a message', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      ];
      const wrapper = JSON.stringify({ actions: [{ action: 'send-message', arguments: { message: 'hi' } }] });

      // Build params the way production does: transformParams stashes originalTools (clearing
      // params.tools), sets the structuredToolCallsActive marker, and installs our responseFormat;
      // wrapGenerate/wrapStream restore tools from originalTools. Routing through here exercises
      // that restore path and the marker instead of hand-populating params.tools.
      async function transformed(mw: any, toolset: any[]) {
        return await (mw.transformParams as any)({
          params: { tools: toolset, toolChoice: { type: 'required' }, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
        });
      }

      it('wrapGenerate rescues send-message from the carrier + wrapper text without double-emitting', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // Non-streaming surfaces BOTH the carrier tool-call (with the wrapper as input) and the
        // structured-output text; the fix must dedupe to a single send-message.
        const doGenerate = async () => ({
          content: [
            { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: wrapper },
            { type: 'text', text: wrapper },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
        });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, gameTools) });
        const toolCalls = result.content.filter((c: any) => c.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0].toolName).toBe('send-message');
        expect(JSON.parse(toolCalls[0].input)).toEqual({ message: 'hi' });
        // Carrier is gone; the raw wrapper text is consumed.
        expect(result.content.some((c: any) => c.type === 'tool-call' && /structuredoutput/i.test(c.toolName))).toBe(false);
        expect(result.content.some((c: any) => c.type === 'text' && c.text.includes('"actions"'))).toBe(false);
        expect(result.finishReason.unified).toBe('tool-calls');
      });

      it('wrapGenerate realigns the argument-key casing to the tool schema (message → Message)', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        const schemaTools = [
          { type: 'function', name: 'send-message', description: 'Send a message', inputSchema: { type: 'object', properties: { Message: { type: 'string' } }, required: ['Message'], additionalProperties: false } },
        ];
        // The model emits lowercase `message`; the schema wants `Message`.
        const wrapperLc = JSON.stringify({ actions: [{ action: 'send-message', arguments: { message: 'Hail' } }] });
        const doGenerate = async () => ({
          content: [
            { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: wrapperLc },
            { type: 'text', text: wrapperLc },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
        });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, schemaTools) });
        const toolCalls = result.content.filter((c: any) => c.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(JSON.parse(toolCalls[0].input)).toEqual({ Message: 'Hail' });
      });

      it('wrapGenerate unwraps a carrier-only response (no wrapper text) via the input fallback', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        const doGenerate = async () => ({
          content: [
            { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: wrapper },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
        });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, gameTools) });
        const toolCalls = result.content.filter((c: any) => c.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0].toolName).toBe('send-message');
        expect(result.finishReason.unified).toBe('tool-calls');
      });

      it('wrapGenerate leaves a genuine game tool-call untouched', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        const native = { type: 'tool-call', toolCallId: 'g1', toolName: 'send-message', input: JSON.stringify({ message: 'x' }) };
        const doGenerate = async () => ({ content: [native], finishReason: { unified: 'tool-calls', raw: 'tool_use' } });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, gameTools) });
        expect(result.content).toEqual([native]);
      });

      // A schema with a nested array-of-objects, exercising the deep native-pass realignment.
      const dealTools = [
        { type: 'function', name: 'propose-deal', description: 'Propose a deal', inputSchema: {
          type: 'object',
          properties: {
            Message: { type: 'string' },
            Give: { type: 'array', items: { type: 'object', properties: { Term: { type: 'string' }, Amount: { type: 'integer' } } } },
          },
        } },
      ];

      it('wrapGenerate realigns a native game tool-call\'s key casing, nested keys included', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // A genuine (non-carrier) game tool-call the model emitted with lowercase top-level + nested keys.
        const native = { type: 'tool-call', toolCallId: 'g1', toolName: 'propose-deal',
          input: JSON.stringify({ message: 'hi', Give: [{ term: 'Gold Per Turn', amount: 3 }] }) };
        const doGenerate = async () => ({ content: [native], finishReason: { unified: 'tool-calls', raw: 'tool_use' } });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, dealTools) });
        const toolCalls = result.content.filter((c: any) => c.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(JSON.parse(toolCalls[0].input)).toEqual({ Message: 'hi', Give: [{ Term: 'Gold Per Turn', Amount: 3 }] });
      });

      it('wrapStream realigns a native game tool-call chunk\'s key casing, nested keys included', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: 'g1', toolName: 'propose-deal',
            input: JSON.stringify({ message: 'hi', Give: [{ term: 'Gold Per Turn', amount: 3 }] }) },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, dealTools) });
        const out = await drain(stream);
        const toolCalls = out.filter((c: any) => c.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(JSON.parse(toolCalls[0].input)).toEqual({ Message: 'hi', Give: [{ Term: 'Gold Per Turn', Amount: 3 }] });
      });

      it('wrapGenerate does not treat a carrier as droppable when structuredToolCalls is off', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action' });
        const carrier = { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: wrapper };
        const doGenerate = async () => ({ content: [carrier], finishReason: { unified: 'tool-calls', raw: 'tool_use' } });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, gameTools) });
        expect(result.content.some((c: any) => /structuredoutput/i.test(c.toolName))).toBe(true);
      });

      it('wrapStream emits ONE send-message even when both text and carrier carry the payload', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // Live behavior: the payload is diverted to text AND the terminal carrier tool-call
        // carries the full wrapper as its own input. Without dedup this double-emits send-message
        // (the `...572`/`...576` duplicate). All carrier chunks must also be suppressed.
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: 'so1', toolName: 'claude-code-tool.StructuredOutput' },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: wrapper },
          { type: 'text-end', id: 't1' },
          { type: 'tool-input-end', id: 'so1' },
          { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: wrapper },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, gameTools) });
        const out = await drain(stream);
        const toolCalls = out.filter((c: any) => c.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0].toolName).toBe('send-message');
        expect(JSON.parse(toolCalls[0].input)).toEqual({ message: 'hi' });
        // No carrier chunk of any kind leaks (tool-input-start/end or the terminal tool-call).
        expect(out.some((c: any) => /structuredoutput/i.test(c.toolName ?? ''))).toBe(false);
        const finish = out.find((c: any) => c.type === 'finish');
        expect(finish.finishReason.unified).toBe('tool-calls');
      });

      it('wrapStream reconciles a carrier emitted before its text copy', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: 'so1', toolName: 'claude-code-tool.StructuredOutput' },
          { type: 'tool-input-end', id: 'so1' },
          { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: wrapper },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: wrapper },
          { type: 'text-end', id: 't1' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, gameTools) });
        const out = await drain(stream);
        expect(out.filter((c: any) => c.type === 'tool-call')).toHaveLength(1);
      });

      it('wrapStream falls back to the carrier input when the diverted text is malformed', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // The diverted text can arrive truncated (`{"actions":}`); the carrier input is the clean
        // authoritative copy, so the send-message must still be recovered from it.
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: 'so1', toolName: 'claude-code-tool.StructuredOutput' },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: '{"actions":}' },
          { type: 'text-end', id: 't1' },
          { type: 'tool-input-end', id: 'so1' },
          { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: wrapper },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, gameTools) });
        const out = await drain(stream);
        const toolCalls = out.filter((c: any) => c.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0].toolName).toBe('send-message');
        expect(out.some((c: any) => /structuredoutput/i.test(c.toolName ?? ''))).toBe(false);
        // The truncated husk (`{"actions":}`) is consumed, never leaked downstream as free text.
        expect(out.some((c: any) => c.type === 'text-delta' && String(c.delta).includes('actions'))).toBe(false);
      });

      it('wrapGenerate strips the wrapper husk text while keeping the carrier-rescued call', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // The text channel carries only the emptied envelope husk; the real call rides the carrier.
        const doGenerate = async () => ({
          content: [
            { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: wrapper },
            { type: 'text', text: '{"actions":}' },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
        });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, gameTools) });
        const toolCalls = result.content.filter((c: any) => c.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0].toolName).toBe('send-message');
        // Husk consumed: no leftover text part echoes the envelope.
        expect(result.content.some((c: any) => c.type === 'text' && c.text.includes('actions'))).toBe(false);
      });

      it('wrapGenerate keeps legitimately repeated identical actions (no over-dedupe)', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // A single wrapper that intentionally repeats the same action twice: both must survive,
        // since dedupe is only meant to collapse the SAME payload arriving via two channels.
        const twice = JSON.stringify({ actions: [
          { action: 'send-message', arguments: { message: 'hi' } },
          { action: 'send-message', arguments: { message: 'hi' } },
        ] });
        const doGenerate = async () => ({
          content: [{ type: 'text', text: twice }],
          finishReason: { unified: 'stop', raw: 'stop' },
        });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, gameTools) });
        expect(result.content.filter((c: any) => c.type === 'tool-call')).toHaveLength(2);
      });

      it('wrapStream keeps legitimately repeated identical actions (no over-dedupe)', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        const twice = JSON.stringify({ actions: [
          { action: 'send-message', arguments: { message: 'hi' } },
          { action: 'send-message', arguments: { message: 'hi' } },
        ] });
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: twice },
          { type: 'text-end', id: 't1' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, gameTools) });
        const out = await drain(stream);
        expect(out.filter((c: any) => c.type === 'tool-call')).toHaveLength(2);
      });

      it('wrapGenerate rescues only the last StructuredOutput attempt across separate text parts', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // Separate text parts in structured mode are retry ATTEMPTS at one forced output, not
        // independent calls: only the last is the CLI-accepted one, so exactly one call survives.
        const doGenerate = async () => ({
          content: [
            { type: 'text', text: wrapper },
            { type: 'text', text: wrapper },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
        });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, gameTools) });
        expect(result.content.filter((c: any) => c.type === 'tool-call')).toHaveLength(1);
      });

      it('wrapGenerate keeps call-free prose that precedes the winning attempt', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // A leading reasoning block (no calls) is NOT a superseded attempt: it must survive as text
        // alongside the committed call, matching wrapStream, which streams such prose live.
        const doGenerate = async () => ({
          content: [
            { type: 'text', text: 'Let me think about this.' },
            { type: 'text', text: wrapper },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
        });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, gameTools) });
        expect(result.content.filter((c: any) => c.type === 'tool-call')).toHaveLength(1);
        expect(result.content.some((c: any) => c.type === 'text' && c.text.includes('Let me think about this.'))).toBe(true);
        expect(result.finishReason.unified).toBe('tool-calls');
      });

      it('wrapStream rescues only the last StructuredOutput attempt across separate text blocks', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: wrapper },
          { type: 'text-end', id: 't1' },
          { type: 'text-start', id: 't2' },
          { type: 'text-delta', id: 't2', delta: wrapper },
          { type: 'text-end', id: 't2' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, gameTools) });
        const out = await drain(stream);
        expect(out.filter((c: any) => c.type === 'tool-call')).toHaveLength(1);
      });

      it('wrapStream commits only the retried attempt when the first is malformed (the incident)', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // Attempt #1 carries a literal newline inside a JSON string. The CLI strictly rejects it and
        // retries, but jaison REPAIRS it during rescue — so without last-attempt-wins its call would
        // resurrect and spawn a second agent alongside the accepted retry (the observed bug).
        const attempt1 = '{"actions":[{"action":"send-message","arguments":{"message":"line one\nline two"}}]}';
        expect(() => JSON.parse(attempt1)).toThrow(); // fixture precondition: strictly invalid JSON
        const attempt2 = JSON.stringify({ actions: [{ action: 'send-message', arguments: { message: 'clean retry' } }] });
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: 'so1', toolName: 'claude-code-tool.StructuredOutput' },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: attempt1 },
          { type: 'text-end', id: 't1' },
          { type: 'text-start', id: 't2' },
          { type: 'text-delta', id: 't2', delta: attempt2 },
          { type: 'text-end', id: 't2' },
          { type: 'tool-input-end', id: 'so1' },
          { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: attempt2 },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, gameTools) });
        const out = await drain(stream);
        const toolCalls = out.filter((c: any) => c.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0].toolName).toBe('send-message');
        expect(JSON.parse(toolCalls[0].input)).toEqual({ message: 'clean retry' });
        // The rejected attempt must not surface anywhere: not as a call, not as leaked text.
        expect(out.some((c: any) => JSON.stringify(c).includes('line two'))).toBe(false);
        expect(out.find((c: any) => c.type === 'finish').finishReason.unified).toBe('tool-calls');
      });

      it('wrapStream drops a valid-JSON attempt that the CLI schema-rejected before the retry', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // Attempt #1 is well-formed JSON (so the mid-block STRICT parse would emit it eagerly if not
        // suppressed) yet was schema-rejected by the CLI; only attempt #2 is accepted (its carrier).
        const attempt1 = JSON.stringify({ actions: [{ action: 'send-message', arguments: { message: 'first valid' } }] });
        const attempt2 = JSON.stringify({ actions: [{ action: 'send-message', arguments: { message: 'second valid' } }] });
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: 'so1', toolName: 'claude-code-tool.StructuredOutput' },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: attempt1 },
          { type: 'text-end', id: 't1' },
          { type: 'text-start', id: 't2' },
          { type: 'text-delta', id: 't2', delta: attempt2 },
          { type: 'text-end', id: 't2' },
          { type: 'tool-input-end', id: 'so1' },
          { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: attempt2 },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, gameTools) });
        const out = await drain(stream);
        const toolCalls = out.filter((c: any) => c.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(JSON.parse(toolCalls[0].input)).toEqual({ message: 'second valid' });
        expect(out.some((c: any) => JSON.stringify(c).includes('first valid'))).toBe(false);
      });

      it('wrapGenerate commits only the last attempt across text parts + matching carrier', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        const attempt1 = JSON.stringify({ actions: [{ action: 'send-message', arguments: { message: 'first valid' } }] });
        const attempt2 = JSON.stringify({ actions: [{ action: 'send-message', arguments: { message: 'second valid' } }] });
        const doGenerate = async () => ({
          content: [
            { type: 'text', text: attempt1 },
            { type: 'text', text: attempt2 },
            { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: attempt2 },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
        });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, gameTools) });
        const toolCalls = result.content.filter((c: any) => c.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(JSON.parse(toolCalls[0].input)).toEqual({ message: 'second valid' });
        expect(result.content.some((c: any) => c.type === 'text' && c.text.includes('first valid'))).toBe(false);
        expect(result.finishReason.unified).toBe('tool-calls');
      });

      it('wrapStream surfaces attempt text and no call when no attempt validates', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // Single attempt naming an unavailable tool, no carrier: nothing is rescuable, so the turn
        // is not silently empty — the payload surfaces as a COMPLETE synthetic text part.
        const badWrapper = JSON.stringify({ actions: [{ action: 'nonexistent-tool', arguments: {} }] });
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: badWrapper },
          { type: 'text-end', id: 't1' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, gameTools) });
        const out = await drain(stream);
        expect(out.filter((c: any) => c.type === 'tool-call')).toHaveLength(0);
        // A finish-time text part must be complete: matching start/delta/end all carrying the payload.
        const synthetic = out.filter((c: any) => String(c.id ?? '').endsWith('-rescued'));
        expect(synthetic.map((c: any) => c.type)).toEqual(['text-start', 'text-delta', 'text-end']);
        expect(synthetic.find((c: any) => c.type === 'text-delta').delta).toContain('nonexistent-tool');
        expect(out.find((c: any) => c.type === 'finish').finishReason.unified).toBe('stop');
      });

      it('wrapStream streams leading prose live and still commits the single attempt', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't0' },
          { type: 'text-delta', id: 't0', delta: 'Let me think about this.' },
          { type: 'text-end', id: 't0' },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: wrapper },
          { type: 'text-end', id: 't1' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, gameTools) });
        const out = await drain(stream);
        // Brace-free prose passes through as a live text-delta (not deferred to finish).
        expect(out.some((c: any) => c.type === 'text-delta' && String(c.delta).includes('Let me think'))).toBe(true);
        expect(out.filter((c: any) => c.type === 'tool-call')).toHaveLength(1);
      });

      it('wrapStream keeps identical actions from separate text blocks in free-text (non-structured) mode', async () => {
        // The deliberate no-dedup guarantee still holds where it is intended: NOT structured mode.
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action' });
        const action = JSON.stringify({ action: 'send-message', arguments: { message: 'hi' } });
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: action },
          { type: 'text-end', id: 't1' },
          { type: 'text-start', id: 't2' },
          { type: 'text-delta', id: 't2', delta: action },
          { type: 'text-end', id: 't2' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, gameTools) });
        const out = await drain(stream);
        expect(out.filter((c: any) => c.type === 'tool-call')).toHaveLength(2);
      });

      it('wrapGenerate keeps identical actions from separate text parts in free-text (non-structured) mode', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action' });
        const action = JSON.stringify({ action: 'send-message', arguments: { message: 'hi' } });
        const doGenerate = async () => ({
          content: [
            { type: 'text', text: action },
            { type: 'text', text: action },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
        });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, gameTools) });
        expect(result.content.filter((c: any) => c.type === 'tool-call')).toHaveLength(2);
      });

      it('wrapGenerate preserves the carrier payload as text when nothing can be rescued', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // Carrier-only response whose action names an unavailable tool: rescue yields nothing.
        const badWrapper = JSON.stringify({ actions: [{ action: 'nonexistent-tool', arguments: {} }] });
        const doGenerate = async () => ({
          content: [
            { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: badWrapper },
          ],
          finishReason: { unified: 'stop', raw: 'stop' },
        });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params: await transformed(mw, gameTools) });
        // The turn is not silently empty: no tool call, but the payload survives as text.
        expect(result.content.filter((c: any) => c.type === 'tool-call')).toHaveLength(0);
        expect(result.content.some((c: any) => c.type === 'text' && c.text.includes('nonexistent-tool'))).toBe(true);
        expect(result.finishReason.unified).toBe('stop');
      });

      it('wrapStream preserves the carrier payload as text when nothing can be rescued', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        const badWrapper = JSON.stringify({ actions: [{ action: 'nonexistent-tool', arguments: {} }] });
        const chunks = [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-input-start', id: 'so1', toolName: 'claude-code-tool.StructuredOutput' },
          { type: 'tool-input-delta', id: 'so1', delta: badWrapper },
          { type: 'tool-input-end', id: 'so1' },
          { type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: badWrapper },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1 } },
        ];
        const doStream = async () => ({ stream: streamFrom(chunks) });
        const { stream }: any = await (mw.wrapStream as any)({ doStream, params: await transformed(mw, gameTools) });
        const out = await drain(stream);
        expect(out.filter((c: any) => c.type === 'tool-call')).toHaveLength(0);
        // Payload surfaced as text rather than dropped to an empty stream; no carrier leaks.
        expect(out.some((c: any) => c.type === 'text-delta' && String(c.delta).includes('nonexistent-tool'))).toBe(true);
        expect(out.some((c: any) => /structuredoutput/i.test(c.toolName ?? ''))).toBe(false);
      });

      it('does not suppress the carrier when a real output schema owns responseFormat', async () => {
        const mw = toolRescueMiddleware({ prompt: true, framing: 'action', structuredToolCalls: true });
        // A genuine output schema already occupies responseFormat, so transformParams must neither
        // install ours nor mark the call active; the StructuredOutput carrier now holds the real
        // structured output and must not be destroyed by tool rescue.
        const existing = { type: 'json', schema: { type: 'object' } };
        const params: any = await (mw.transformParams as any)({
          params: { tools: gameTools, toolChoice: { type: 'required' }, responseFormat: existing, prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
        });
        expect(params.structuredToolCallsActive).toBeUndefined();
        const realOutput = JSON.stringify({ result: 42 });
        const doGenerate = async () => ({
          content: [{ type: 'tool-call', toolCallId: 'so1', toolName: 'claude-code-tool.StructuredOutput', input: realOutput }],
          finishReason: { unified: 'stop', raw: 'stop' },
        });
        const result: any = await (mw.wrapGenerate as any)({ doGenerate, params });
        expect(result.content.some((c: any) => /structuredoutput/i.test(c.toolName ?? ''))).toBe(true);
      });
    });

    it("threads 'action' framing end-to-end through getModel when built-in CLI tools are enabled", async () => {
      const tempRoot = path.join(os.tmpdir(), 'vox-claude-code');
      try {
        const model = getModel(
          {
            provider: 'claude-code',
            name: 'sonnet',
            options: { toolMiddleware: 'prompt', claudeCodeTools: ['Read'] },
          },
          { workingDirId: 'g3-1' }
        );
        await (model as any).doGenerate({
          tools,
          toolChoice: { type: 'auto' },
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          providerOptions: {},
        });
        const calls = mocks.model.doGenerateCalls;
        const sys = calls[calls.length - 1].prompt.find((m: any) => m.role === 'system');
        expect(sys).toBeDefined();
        expect(sys.content).toContain('## Action Calling');
        expect(sys.content).toContain('## Available Actions');
        // The reframed prompt must not mention the built-in CLI tools at all.
        expect(sys.content).not.toContain('Built-in');
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    it('uses Action framing for pure-text claude-code too (no built-in tools)', async () => {
      const model = getModel(
        { provider: 'claude-code', name: 'sonnet', options: { toolMiddleware: 'prompt' } }
      );
      await (model as any).doGenerate({
        tools,
        toolChoice: { type: 'auto' },
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        providerOptions: {},
      });
      const calls = mocks.model.doGenerateCalls;
      const sys = calls[calls.length - 1].prompt.find((m: any) => m.role === 'system');
      expect(sys).toBeDefined();
      // claude-code is always action-framed, regardless of built-in CLI tools.
      expect(sys.content).toContain('## Action Calling');
      expect(sys.content).not.toContain('## Tool Calling');
    });

    // Regression for the negotiator/diplomat prompt shape: a main system prompt + game context,
    // then a TRAILING system nudge after the user messages. Without normalization the provider
    // keeps only the trailing nudge, dropping the main prompt and the injected action schemas.
    // Asserts the surviving system message carries both leading systems plus the schema block,
    // and the trailing nudge is demoted to a user message.
    it('preserves the action schema block when the agent appends a trailing system message', async () => {
      const model = getModel({ provider: 'claude-code', name: 'haiku', options: { toolMiddleware: 'prompt' } });
      await (model as any).doGenerate({
        tools,
        toolChoice: { type: 'required' },
        prompt: [
          { role: 'system', content: 'You are the deal negotiator for Brazil.' },
          { role: 'system', content: '# Situation ...' },
          { role: 'user', content: [{ type: 'text', text: '# Victory Progress ...' }] },
          { role: 'user', content: [{ type: 'text', text: '# Diplomat Briefing ...' }] },
          { role: 'system', content: 'Use exactly one tool in the provided format.' },
        ],
        providerOptions: {},
      });
      const finalPrompt = mocks.model.doGenerateCalls.at(-1).prompt;
      // Exactly one system message survives normalization (the one the provider keeps).
      const systems = finalPrompt.filter((m: any) => m.role === 'system');
      expect(systems).toHaveLength(1);
      const sys = systems[0].content as string;
      // It carries the agent's main prompt, the game context, AND the injected action schemas.
      expect(sys).toContain('You are the deal negotiator for Brazil.');
      expect(sys).toContain('# Situation ...');
      expect(sys).toContain('## Available Actions');
      // The trailing nudge is demoted to a user message (its text survives inline, not dropped).
      // The upstream tool-rescue middleware reframes "tool" wording to "action" for action-framed
      // providers (reframeToolWording), so match the reframed text, not the seeded input.
      const nudge = finalPrompt.find(
        (m: any) => m.role === 'user' && Array.isArray(m.content)
          && m.content.some((c: any) => c.text?.includes('exactly one action in the provided format'))
      );
      expect(nudge).toBeDefined();
    });
  });
});

describe('resolveToolFraming', () => {
  it("returns 'action' for claude-code regardless of built-in CLI tools", () => {
    // With built-in CLI tools...
    expect(resolveToolFraming(
      { provider: 'claude-code', name: 'sonnet', options: { claudeCodeTools: ['Read'] } }
    )).toBe('action');
    expect(resolveToolFraming(
      { provider: 'claude-code', name: 'sonnet', options: { claudeCodeTools: ['everything'] } }
    )).toBe('action');
    // ...and for pure-text claude-code (no or empty claudeCodeTools).
    expect(resolveToolFraming({ provider: 'claude-code', name: 'sonnet' })).toBe('action');
    expect(resolveToolFraming(
      { provider: 'claude-code', name: 'sonnet', options: { claudeCodeTools: [] } }
    )).toBe('action');
  });

  it("returns 'tool' for any non-claude-code provider, even if claudeCodeTools is set", () => {
    expect(resolveToolFraming({ provider: 'openrouter', name: 'x' })).toBe('tool');
    expect(resolveToolFraming(
      { provider: 'openrouter', name: 'x', options: { claudeCodeTools: ['Read'] } }
    )).toBe('tool');
  });

  it('honors an explicit options.framing override regardless of provider (Oracle replay)', () => {
    // Force 'action' on a plain provider to reproduce a recorded action-framed turn.
    expect(resolveToolFraming({ provider: 'openrouter', name: 'x', options: { framing: 'action' } })).toBe('action');
    // An explicit 'tool' override beats the claude-code+built-in-tools default.
    expect(resolveToolFraming(
      { provider: 'claude-code', name: 'sonnet', options: { claudeCodeTools: ['Read'], framing: 'tool' } }
    )).toBe('tool');
  });
});
