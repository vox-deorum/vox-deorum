/**
 * Mock-tier tests for post-hoc enforcement of a narrowed step.
 *
 * A removed tool stays declared, so the model can still call it. The rejection map from
 * buildRemovedToolRejections must make the AI SDK mark only that call invalid with an error result,
 * while other calls in the same reply execute normally. This holds for native tool calls and for
 * calls the prompt-mode rescue extracts from text, and the prompt-mode schema block must not change.
 */

import { describe, expect, it, vi } from 'vitest';
import { jsonSchema, streamText, tool, wrapLanguageModel } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { buildRemovedToolRejections } from '../../../../src/agents/tools/tool-availability.js';
import { toolRescueMiddleware } from '../../../../src/agents/models/tool-rescue/middleware.js';

const finish = {
  type: 'finish',
  finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
  usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
};

/** Build a mock model that streams the given chunks on every call. */
function mockModel(chunks: unknown[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...chunks, finish] as any }),
    }),
  });
}

/** Build two declared tools with spied executors. */
function makeTools() {
  const allowedExecute = vi.fn(async () => 'allowed ran');
  const removedExecute = vi.fn(async () => 'removed ran');
  const schema = jsonSchema({ type: 'object', properties: {} });
  return {
    allowedExecute,
    removedExecute,
    tools: {
      allowed: tool({ description: 'allowed tool', inputSchema: schema, execute: allowedExecute }),
      removed: tool({ description: 'removed tool', inputSchema: schema, execute: removedExecute }),
    },
  };
}

/** Run one step with both tools declared and, optionally, `removed` narrowed out. */
async function runStep(model: any, narrowed: boolean) {
  const { tools, allowedExecute, removedExecute } = makeTools();
  const result = streamText({
    model,
    prompt: 'act',
    tools,
    activeTools: ['allowed', 'removed'],
    experimental_refineToolInput: narrowed
      ? buildRemovedToolRejections(['allowed', 'removed'], ['allowed']) as any
      : undefined,
    stopWhen: () => true,
  });
  const steps = await result.steps;
  return { step: steps[0], allowedExecute, removedExecute };
}

/** Assert the step executed `allowed` and rejected only the `removed` call. */
function expectSplit({ step, allowedExecute, removedExecute }: Awaited<ReturnType<typeof runStep>>) {
  expect(allowedExecute).toHaveBeenCalledTimes(1);
  expect(removedExecute).not.toHaveBeenCalled();

  const removedCall = step.toolCalls.find((call: any) => call.toolName === 'removed') as any;
  const allowedCall = step.toolCalls.find((call: any) => call.toolName === 'allowed') as any;
  expect(removedCall?.invalid).toBe(true);
  expect(allowedCall?.invalid).toBeFalsy();

  expect(step.toolResults.map((r: any) => r.toolName)).toEqual(['allowed']);
  const errors = step.content.filter((part: any) => part.type === 'tool-error');
  expect(errors.map((part: any) => part.toolName)).toEqual(['removed']);
  expect(String(errors[0].error)).toContain('removed');
}

describe('narrowed tool rejection', () => {
  describe('buildRemovedToolRejections', () => {
    it('should return nothing when no declared tool was removed', () => {
      expect(buildRemovedToolRejections(['a', 'b'], ['a', 'b'])).toBeUndefined();
    });

    it('should add an entry only for removed tools', () => {
      const rejections = buildRemovedToolRejections(['a', 'b', 'c'], ['b'])!;
      expect(Object.keys(rejections).sort()).toEqual(['a', 'c']);
      expect(() => rejections.a({})).toThrow();
    });
  });

  describe('native tool calls', () => {
    it('should execute the allowed call and reject only the removed one in the same reply', async () => {
      const model = mockModel([
        { type: 'tool-call', toolCallId: 'c1', toolName: 'removed', input: '{}' },
        { type: 'tool-call', toolCallId: 'c2', toolName: 'allowed', input: '{}' },
      ]);
      expectSplit(await runStep(model, true));
    });

    it('should keep both tools declared to the model', async () => {
      const model = mockModel([{ type: 'tool-call', toolCallId: 'c1', toolName: 'allowed', input: '{}' }]);
      await runStep(model, true);
      expect(model.doStreamCalls[0].tools?.map((t: any) => t.name).sort()).toEqual(['allowed', 'removed']);
    });
  });

  describe('prompt-mode tool calls', () => {
    const text = '[{"tool": "removed", "arguments": {}}, {"tool": "allowed", "arguments": {}}]';

    /** Wrap a text-only mock model in the prompt-mode rescue middleware. */
    function promptModeModel() {
      const inner = mockModel([
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: text },
        { type: 'text-end', id: 't' },
      ]);
      return { inner, model: wrapLanguageModel({ model: inner, middleware: toolRescueMiddleware({ prompt: true }) }) };
    }

    it('should execute the allowed rescued call and reject only the removed one', async () => {
      expectSplit(await runStep(promptModeModel().model, true));
    });

    it('should inject the same tool schema block whether or not the step is narrowed', async () => {
      const narrowed = promptModeModel();
      const full = promptModeModel();
      await runStep(narrowed.model, true);
      await runStep(full.model, false);
      expect(narrowed.inner.doStreamCalls[0].prompt).toEqual(full.inner.doStreamCalls[0].prompt);
    });
  });
});
