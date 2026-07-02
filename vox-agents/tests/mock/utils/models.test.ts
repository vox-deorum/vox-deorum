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
const mocks = vi.hoisted(() => ({ captured: undefined as any, model: undefined as any }));

vi.mock('ai-sdk-provider-claude-code', () => {
  const factory = vi.fn((_id: string, settings: any) => {
    mocks.captured = settings;
    // A static generate result so the wrapped model's doGenerate can be invoked without
    // triggering tool-call rescue (plain text, no game-tool JSON).
    mocks.model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: 'text', text: 'ok' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      } as any,
    });
    return mocks.model;
  });
  return { createClaudeCode: () => factory, claudeCode: factory };
});

import { getModel, getModelConfig, resolveToolFraming } from '../../../src/utils/models/models.js';
import { toolRescueMiddleware } from '../../../src/utils/models/tool-rescue/middleware.js';

// The vetted safe set that claude-code's ['everything'] expands to (mirrors models.ts).
const SAFE_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Write', 'Edit', 'TodoWrite'];

describe('claude-code provider', () => {
  beforeEach(() => {
    mocks.captured = undefined;
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
    it('should isolate filesystem settings and disable all built-in tools', () => {
      getModel({ provider: 'claude-code', name: 'sonnet', options: { toolMiddleware: 'prompt' } });
      expect(mocks.captured).toBeDefined();
      expect(mocks.captured.settingSources).toEqual([]);
      expect(mocks.captured.tools).toEqual([]);
    });

    it('should map a non-minimal reasoningEffort to effort with no thinking override', () => {
      getModel({
        provider: 'claude-code',
        name: 'opus',
        options: { toolMiddleware: 'prompt', reasoningEffort: 'high' }
      });
      expect(mocks.captured.effort).toBe('high');
      expect(mocks.captured.thinking).toBeUndefined();
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

    it('stays on the default Tool framing for pure-text claude-code (no built-in tools)', async () => {
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
      expect(sys.content).toContain('## Tool Calling');
      expect(sys.content).not.toContain('## Action Calling');
    });
  });
});

describe('resolveToolFraming', () => {
  it("returns 'action' for claude-code with built-in CLI tools", () => {
    expect(resolveToolFraming(
      { provider: 'claude-code', name: 'sonnet', options: { claudeCodeTools: ['Read'] } }
    )).toBe('action');
    expect(resolveToolFraming(
      { provider: 'claude-code', name: 'sonnet', options: { claudeCodeTools: ['everything'] } }
    )).toBe('action');
  });

  it("returns 'tool' for pure-text claude-code (no or empty claudeCodeTools)", () => {
    expect(resolveToolFraming({ provider: 'claude-code', name: 'sonnet' })).toBe('tool');
    expect(resolveToolFraming(
      { provider: 'claude-code', name: 'sonnet', options: { claudeCodeTools: [] } }
    )).toBe('tool');
  });

  it("returns 'tool' for any non-claude-code provider, even if claudeCodeTools is set", () => {
    expect(resolveToolFraming({ provider: 'openrouter', name: 'x' })).toBe('tool');
    expect(resolveToolFraming(
      { provider: 'openrouter', name: 'x', options: { claudeCodeTools: ['Read'] } }
    )).toBe('tool');
  });
});
