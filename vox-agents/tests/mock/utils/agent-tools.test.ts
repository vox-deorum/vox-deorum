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
import { asSchema } from 'ai';
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

/** Validate a tool input through the AI SDK schema adapter. */
async function validateToolInput(tool: ReturnType<typeof createAgentTool>, input: unknown) {
  return asSchema(tool.inputSchema).validate!(input);
}

describe('createAgentTool', () => {
  describe('description and schema defaults', () => {
    it('uses the agent toolDescription when provided', () => {
      const tool = createAgentTool(
        fakeAgent({ toolDescription: 'Custom tool description' }),
        ctx.asContext()
      );
      expect(tool.description).toBe('Custom tool description');
    });

    it('exposes a default Prompt field when the agent has no inputSchema', async () => {
      const tool = createAgentTool(fakeAgent(), ctx.asContext());
      await expect(validateToolInput(tool, { Prompt: 'hello' })).resolves.toMatchObject({ success: true });
      await expect(validateToolInput(tool, { Prompt: 123 })).resolves.toMatchObject({ success: false });
    });

    it('uses the agent inputSchema and validates the optional tier', async () => {
      const inputSchema = z.object({ Foo: z.number().describe('Caller field') });
      const tool = createAgentTool(fakeAgent({ inputSchema }), ctx.asContext());
      await expect(validateToolInput(tool, { Foo: 1, Tier: 'large' }))
        .resolves.toEqual({ success: true, value: { Foo: 1, Tier: 'large' } });
      await expect(validateToolInput(tool, { Foo: 1, Tier: 'huge' }))
        .resolves.toMatchObject({ success: false });
      const schema = await asSchema(tool.inputSchema).jsonSchema;
      expect(schema.properties?.Foo).toMatchObject({ description: 'Caller field' });
    });

    it('prefers the caller-facing handoffSchema over inputSchema', async () => {
      const handoffSchema = z.object({ Briefing: z.string() });
      const inputSchema = z.object({ Foo: z.number() });
      const tool = createAgentTool(fakeAgent({ handoffSchema, inputSchema }), ctx.asContext());
      await expect(validateToolInput(tool, { Briefing: 'ok', Tier: 'small' }))
        .resolves.toEqual({ success: true, value: { Briefing: 'ok', Tier: 'small' } });
      await expect(validateToolInput(tool, { Foo: 1 })).resolves.toMatchObject({ success: false });
    });

    it('preserves refinements from the caller schema while accepting tier metadata', async () => {
      const handoffSchema = z.object({ Start: z.number(), End: z.number() })
        .refine(({ Start, End }) => End > Start, 'End must follow Start');
      const tool = createAgentTool(fakeAgent({ handoffSchema }), ctx.asContext());

      await expect(validateToolInput(tool, { Start: 1, End: 2, Tier: 'default' }))
        .resolves.toEqual({ success: true, value: { Start: 1, End: 2, Tier: 'default' } });
      await expect(validateToolInput(tool, { Start: 2, End: 1, Tier: 'default' }))
        .resolves.toMatchObject({ success: false });
    });

    it('strips tier before original schema refinements and mapping', async () => {
      const refinedValues: unknown[] = [];
      const handoffSchema = z.object({ Prompt: z.string() }).strict()
        .superRefine((input, issueContext) => {
          refinedValues.push(input);
          if ('Tier' in input) issueContext.addIssue({ code: 'custom', message: 'Tier leaked into caller schema' });
        });
      const resolveHandoffInput = vi.fn((input: unknown) => input);
      const tool = createAgentTool(fakeAgent({ handoffSchema, resolveHandoffInput }), ctx.asContext());
      ctx.execute.mockResolvedValue('ok');

      const validation = await validateToolInput(tool, { Prompt: 'p', Tier: 'large' });
      expect(validation.success).toBe(true);
      if (!validation.success) throw validation.error;
      expect(refinedValues).toEqual([{ Prompt: 'p' }]);

      await tool.execute!(validation.value, { toolCallId: 'x', messages: [] });

      expect(resolveHandoffInput).toHaveBeenCalledWith({ Prompt: 'p' }, ctx.asContext());
      expect(refinedValues).toEqual([{ Prompt: 'p' }]);
    });

    it('applies caller schema transforms once before sending input to the target agent', async () => {
      const transform = vi.fn(Number);
      const handoffSchema = z.object({ Count: z.string().transform(transform) });
      const tool = createAgentTool(fakeAgent({ handoffSchema }), ctx.asContext());
      ctx.execute.mockResolvedValue('ok');

      const validation = await validateToolInput(tool, { Count: '3' });
      expect(validation.success).toBe(true);
      if (!validation.success) throw validation.error;
      await tool.execute!(validation.value, { toolCallId: 'x', messages: [] });

      expect(transform).toHaveBeenCalledTimes(1);
      expect(ctx.execute).toHaveBeenCalledWith('test-agent', { Count: 3 });
    });
  });

  describe('handoff input enrichment', () => {
    it('maps the caller args through resolveHandoffInput before executing', async () => {
      ctx.execute.mockResolvedValue('ok');
      const context = ctx.asContext();
      // Enrich the caller args with ambient context (here: a constant) before execution.
      const resolveHandoffInput = vi.fn((args: any) => ({ ...args, enriched: true }));

      const tool = createAgentTool(fakeAgent({ name: 'worker', resolveHandoffInput }), context);
      await tool.execute!({ Prompt: 'hi' }, { toolCallId: 'x', messages: [] });

      expect(resolveHandoffInput).toHaveBeenCalledWith({ Prompt: 'hi' }, context);
      // execute() takes no parameter argument — the nested run resolves the active root's params.
      expect(ctx.execute).toHaveBeenCalledWith('worker', { Prompt: 'hi', enriched: true });
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

    it('removes tier metadata before mapping and passes it to the resolved target execution', async () => {
      ctx.execute.mockResolvedValue('ok');
      const resolveHandoffInput = vi.fn((args: any) => args);
      const tool = createAgentTool(fakeAgent({
        name: 'base', resolveHandoffInput, resolveHandoffTarget: () => 'seat-variant'
      }), ctx.asContext());
      await tool.execute!({ Prompt: 'hi', Tier: 'large' }, { toolCallId: 'x', messages: [] });

      expect(resolveHandoffInput).toHaveBeenCalledWith({ Prompt: 'hi' }, ctx.asContext());
      expect(ctx.execute).toHaveBeenCalledWith('seat-variant', { Prompt: 'hi' }, undefined, undefined, undefined, { triage: { tier: 'large' } });
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

      expect(out).toMatchObject({ result: expect.any(String) });
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

    it('passes an explicit tier to detached work', async () => {
      ctx.execute.mockResolvedValue('async-result');
      const tool = createAgentTool(fakeAgent({ fireAndForget: true }), ctx.asContext());
      await tool.execute!({ Prompt: 'p', Tier: 'small' }, { toolCallId: 'x', messages: [] });

      await vi.waitFor(() => expect(ctx.execute).toHaveBeenCalledWith(
        'test-agent', { Prompt: 'p' }, undefined, undefined, undefined, { triage: { tier: 'small' } }
      ));
    });

    it('does not reject even when the detached execution fails', async () => {
      ctx.execute.mockRejectedValue(new Error('background boom'));

      const tool = createAgentTool(
        fakeAgent({ fireAndForget: true }),
        ctx.asContext()
      );
      const out = await tool.execute!({ Prompt: 'p' }, { toolCallId: 'x', messages: [] });

      expect(out).toMatchObject({ result: expect.any(String) });
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
