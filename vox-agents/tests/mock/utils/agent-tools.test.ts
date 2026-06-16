/**
 * Tests for createAgentTool (src/utils/tools/agent-tools.ts) — the wrapper that exposes a
 * VoxAgent as a Vercel AI SDK dynamicTool. Covers description/schema defaults, normal vs.
 * fire-and-forget execution, the toolsGetter, output-schema parsing, and error propagation.
 * Uses the shared FakeVoxContext fixture (its `.execute` is a vi.fn spy) — no live model.
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
      const tool = createAgentTool(fakeAgent({ name: 'strategist' }), ctx.asContext(), () => ({} as any));
      expect(tool.description).toBe('Execute the strategist agent to handle specialized tasks');
    });

    it('uses the agent toolDescription when provided', () => {
      const tool = createAgentTool(
        fakeAgent({ toolDescription: 'Custom tool description' }),
        ctx.asContext(),
        () => ({} as any)
      );
      expect(tool.description).toBe('Custom tool description');
    });

    it('uses a default { Prompt: string } schema when the agent has no inputSchema', () => {
      const tool = createAgentTool(fakeAgent(), ctx.asContext(), () => ({} as any));
      // The default schema accepts a Prompt string and rejects other shapes.
      expect(() => (tool.inputSchema as z.ZodTypeAny).parse({ Prompt: 'hello' })).not.toThrow();
      expect(() => (tool.inputSchema as z.ZodTypeAny).parse({ Prompt: 123 })).toThrow();
    });

    it('uses the agent inputSchema when provided', () => {
      const inputSchema = z.object({ Foo: z.number() });
      const tool = createAgentTool(fakeAgent({ inputSchema }), ctx.asContext(), () => ({} as any));
      expect(tool.inputSchema).toBe(inputSchema);
    });
  });

  describe('non-fire-and-forget execution', () => {
    it('calls context.execute(name, parameters, input) and wraps the result', async () => {
      ctx.execute.mockResolvedValue('the-result');
      const params = { playerID: 1, gameID: 'g', turn: 5 } as any;
      const input = { Prompt: 'do it' };

      const tool = createAgentTool(fakeAgent({ name: 'worker' }), ctx.asContext(), () => params);
      const out = await tool.execute!(input, { toolCallId: 'x', messages: [] });

      expect(ctx.execute).toHaveBeenCalledWith('worker', params, input);
      expect(out).toEqual({ result: 'the-result' });
    });

    it('invokes the toolsGetter to obtain the parameters', async () => {
      ctx.execute.mockResolvedValue('ok');
      const params = { playerID: 2, gameID: 'g2', turn: 7 } as any;
      const toolsGetter = vi.fn(() => params);

      const tool = createAgentTool(fakeAgent(), ctx.asContext(), toolsGetter);
      await tool.execute!({ Prompt: 'p' }, { toolCallId: 'x', messages: [] });

      expect(toolsGetter).toHaveBeenCalledTimes(1);
      expect(ctx.execute).toHaveBeenCalledWith('test-agent', params, { Prompt: 'p' });
    });

    it('parses the output through the agent outputSchema when defined', async () => {
      const outputSchema = z.object({ score: z.number() });
      ctx.execute.mockResolvedValue({ score: 42, extra: 'dropped' });

      const tool = createAgentTool(fakeAgent({ outputSchema }), ctx.asContext(), () => ({} as any));
      const out = await tool.execute!({ Prompt: 'p' }, { toolCallId: 'x', messages: [] });

      // outputSchema.parse strips unknown keys; result is the parsed object, not wrapped in { result }.
      expect(out).toEqual({ score: 42 });
    });

    it('rejects when the outputSchema parse fails on a mismatched result', async () => {
      const outputSchema = z.object({ score: z.number() });
      ctx.execute.mockResolvedValue({ score: 'not-a-number' });

      const tool = createAgentTool(fakeAgent({ outputSchema }), ctx.asContext(), () => ({} as any));
      await expect(
        tool.execute!({ Prompt: 'p' }, { toolCallId: 'x', messages: [] })
      ).rejects.toThrow();
    });
  });

  describe('fire-and-forget execution', () => {
    it('returns immediately and still triggers a detached context.execute', async () => {
      ctx.execute.mockResolvedValue('async-result');
      const params = { playerID: 1, gameID: 'g', turn: 5 } as any;
      const input = { Prompt: 'async task' };

      const tool = createAgentTool(
        fakeAgent({ name: 'async-agent', fireAndForget: true }),
        ctx.asContext(),
        () => params
      );
      const out = await tool.execute!(input, { toolCallId: 'x', messages: [] });

      expect(out).toEqual({ result: 'Submitted for asynchronous processing.' });
      await vi.waitFor(() =>
        expect(ctx.execute).toHaveBeenCalledWith('async-agent', params, input)
      );
    });

    it('does not reject even when the detached execution fails', async () => {
      ctx.execute.mockRejectedValue(new Error('background boom'));

      const tool = createAgentTool(
        fakeAgent({ fireAndForget: true }),
        ctx.asContext(),
        () => ({} as any)
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

      const tool = createAgentTool(fakeAgent(), ctx.asContext(), () => ({} as any));
      await expect(
        tool.execute!({ Prompt: 'p' }, { toolCallId: 'x', messages: [] })
      ).rejects.toThrow('execution failed');
    });
  });
});
