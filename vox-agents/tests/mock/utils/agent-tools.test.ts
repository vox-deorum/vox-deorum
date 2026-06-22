/**
 * Tests for createAgentTool (src/utils/tools/agent-tools.ts) — the wrapper that exposes a
 * VoxAgent as a Vercel AI SDK dynamicTool. Covers description/schema defaults, normal vs.
 * fire-and-forget execution, output-schema parsing, and error propagation. The wrapped agent
 * runs as a nested/forked execution that resolves its parameters from the active run, so
 * execute() is called with just (name, input). Uses the shared FakeVoxContext fixture (its
 * `.execute` is a vi.fn spy) — no live model.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { createAgentTool } from '../../../src/utils/tools/agent-tools.js';
import { createFakeVoxContext, FakeVoxContext } from '../../helpers/fake-vox-context.js';

/** Build a minimal fake agent with only the fields the wrapper reads. */
function fakeAgent(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'test-agent',
    fireAndForget: false,
    // Mirror VoxAgent's defaults: pass the caller args through and execute this agent itself.
    resolveHandoffInput: (callerArgs: unknown) => callerArgs,
    resolveHandoffTarget(this: { name: string }) { return this.name; },
    ...overrides,
  };
}

let ctx: FakeVoxContext;
beforeEach(() => {
  ctx = createFakeVoxContext();
});

describe('createAgentTool', () => {
  describe('description and schema defaults', () => {
    it('uses a default description when the agent has no toolDescription', () => {
      const tool = createAgentTool(fakeAgent({ name: 'strategist' }), ctx.asContext());
      expect(tool.description).toBe('Execute the strategist agent to handle specialized tasks');
    });

    it('uses the agent toolDescription when provided', () => {
      const tool = createAgentTool(
        fakeAgent({ toolDescription: 'Custom tool description' }),
        ctx.asContext()
      );
      expect(tool.description).toBe('Custom tool description');
    });

    it('uses a default { Prompt: string } schema when the agent has no inputSchema', () => {
      const tool = createAgentTool(fakeAgent(), ctx.asContext());
      // The default schema accepts a Prompt string and rejects other shapes.
      expect(() => (tool.inputSchema as z.ZodTypeAny).parse({ Prompt: 'hello' })).not.toThrow();
      expect(() => (tool.inputSchema as z.ZodTypeAny).parse({ Prompt: 123 })).toThrow();
    });

    it('uses the agent inputSchema when provided', () => {
      const inputSchema = z.object({ Foo: z.number() });
      const tool = createAgentTool(fakeAgent({ inputSchema }), ctx.asContext());
      expect(tool.inputSchema).toBe(inputSchema);
    });

    it('prefers the caller-facing handoffSchema over inputSchema', () => {
      const handoffSchema = z.object({ Briefing: z.string() });
      const inputSchema = z.object({ Foo: z.number() });
      const tool = createAgentTool(fakeAgent({ handoffSchema, inputSchema }), ctx.asContext());
      expect(tool.inputSchema).toBe(handoffSchema);
    });
  });

  describe('handoff input enrichment', () => {
    it('maps the caller args through resolveHandoffInput before executing', async () => {
      ctx.execute.mockResolvedValue('ok');
      const context = ctx.asContext();
      // Enrich the caller args with ambient context (here: a constant) before execution.
      const resolveHandoffInput = vi.fn((args: any) => ({ ...args, enriched: true }));

      const tool = createAgentTool(fakeAgent({ name: 'worker', resolveHandoffInput }), context);
      await tool.execute!({ Briefing: 'hi' }, { toolCallId: 'x', messages: [] });

      expect(resolveHandoffInput).toHaveBeenCalledWith({ Briefing: 'hi' }, context);
      // execute() takes no parameter argument — the nested run resolves the active root's params.
      expect(ctx.execute).toHaveBeenCalledWith('worker', { Briefing: 'hi', enriched: true });
    });

    it('executes the agent named by resolveHandoffTarget (per-seat dispatch)', async () => {
      ctx.execute.mockResolvedValue('ok');
      // The bound tool is `call-base`, but the handoff dispatches to a context-resolved variant.
      const resolveHandoffTarget = vi.fn(() => 'seat-variant');

      const tool = createAgentTool(fakeAgent({ name: 'base', resolveHandoffTarget }), ctx.asContext());
      await tool.execute!({ Prompt: 'p' }, { toolCallId: 'x', messages: [] });

      expect(resolveHandoffTarget).toHaveBeenCalledTimes(1);
      expect(ctx.execute).toHaveBeenCalledWith('seat-variant', { Prompt: 'p' });
    });
  });

  describe('non-fire-and-forget execution', () => {
    it('calls context.execute(name, input) and wraps the result', async () => {
      ctx.execute.mockResolvedValue('the-result');
      const input = { Prompt: 'do it' };

      const tool = createAgentTool(fakeAgent({ name: 'worker' }), ctx.asContext());
      const out = await tool.execute!(input, { toolCallId: 'x', messages: [] });

      expect(ctx.execute).toHaveBeenCalledWith('worker', input);
      expect(out).toEqual({ result: 'the-result' });
    });

    it('parses the output through the agent outputSchema when defined', async () => {
      const outputSchema = z.object({ score: z.number() });
      ctx.execute.mockResolvedValue({ score: 42, extra: 'dropped' });

      const tool = createAgentTool(fakeAgent({ outputSchema }), ctx.asContext());
      const out = await tool.execute!({ Prompt: 'p' }, { toolCallId: 'x', messages: [] });

      // outputSchema.parse strips unknown keys; result is the parsed object, not wrapped in { result }.
      expect(out).toEqual({ score: 42 });
    });

    it('rejects when the outputSchema parse fails on a mismatched result', async () => {
      const outputSchema = z.object({ score: z.number() });
      ctx.execute.mockResolvedValue({ score: 'not-a-number' });

      const tool = createAgentTool(fakeAgent({ outputSchema }), ctx.asContext());
      await expect(
        tool.execute!({ Prompt: 'p' }, { toolCallId: 'x', messages: [] })
      ).rejects.toThrow();
    });
  });

  describe('fire-and-forget execution', () => {
    it('returns immediately and still triggers a detached context.execute', async () => {
      ctx.execute.mockResolvedValue('async-result');
      const input = { Prompt: 'async task' };

      const tool = createAgentTool(
        fakeAgent({ name: 'async-agent', fireAndForget: true }),
        ctx.asContext()
      );
      const out = await tool.execute!(input, { toolCallId: 'x', messages: [] });

      expect(out).toEqual({ result: 'Submitted for asynchronous processing.' });
      await vi.waitFor(() =>
        expect(ctx.execute).toHaveBeenCalledWith('async-agent', input)
      );
    });

    it('runs the detached execution on a forked root (tracked + reachable by abort), not a nested execute', async () => {
      // The detached analyst must run on its own root via forkRun — not a bare context.execute,
      // which would push a child frame on the caller's root and be orphaned once that run settles.
      ctx.execute.mockResolvedValue('async-result');
      const input = { Prompt: 'async task' };

      const tool = createAgentTool(
        fakeAgent({ name: 'async-agent', fireAndForget: true }),
        ctx.asContext()
      );
      await tool.execute!(input, { toolCallId: 'x', messages: [] });

      expect(ctx.forkRun).toHaveBeenCalledTimes(1);
      // The execute() happens inside the forked run's callback, not as a direct caller-root call.
      await vi.waitFor(() =>
        expect(ctx.execute).toHaveBeenCalledWith('async-agent', input)
      );
    });

    it('does not reject even when the detached execution fails', async () => {
      ctx.execute.mockRejectedValue(new Error('background boom'));

      const tool = createAgentTool(
        fakeAgent({ fireAndForget: true }),
        ctx.asContext()
      );
      const out = await tool.execute!({ Prompt: 'p' }, { toolCallId: 'x', messages: [] });

      expect(out).toEqual({ result: 'Submitted for asynchronous processing.' });
      await vi.waitFor(() => expect(ctx.execute).toHaveBeenCalled());
    });
  });

  describe('error propagation', () => {
    it('rejects when context.execute rejects (non-fire-and-forget)', async () => {
      const error = new Error('execution failed');
      ctx.execute.mockRejectedValue(error);

      const tool = createAgentTool(fakeAgent(), ctx.asContext());
      await expect(
        tool.execute!({ Prompt: 'p' }, { toolCallId: 'x', messages: [] })
      ).rejects.toThrow('execution failed');
    });
  });
});
