/**
 * Mock-tier tests for the batch-mode guard in streamTextWithConcurrency.
 *
 * The batch path serializes params.messages/params.tools directly to the provider's
 * native request and never runs the tool-rescue middleware. Replaying a prompt-mode
 * model that way would silently send native tools, skip system rewording, and record
 * no framing telemetry — so the guard must reject that combination while still routing
 * native tool-calling models through the batch manager unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasBatchManager: vi.fn(() => true),
  enqueue: vi.fn(async () => ({ id: 'chat-completion' })),
  convertToStepResult: vi.fn((r: unknown) => ({ steps: ['converted', r] })),
}));

vi.mock('../../../src/oracle/batch/batch-manager.js', () => ({
  hasBatchManager: mocks.hasBatchManager,
  getBatchManager: () => ({ enqueue: mocks.enqueue }),
}));

vi.mock('../../../src/oracle/batch/format-converter.js', () => ({
  convertToStepResult: mocks.convertToStepResult,
}));

import { streamTextWithConcurrency, withModelConfig } from '../../../src/utils/models/concurrency.js';

// The guard runs before any retry/streaming machinery, touching only context.timeoutRefresh.
const fakeContext = { timeoutRefresh: () => {} } as any;

beforeEach(() => {
  mocks.hasBatchManager.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('streamTextWithConcurrency batch guard', () => {
  it('rejects a prompt-mode model when the batch manager is active', async () => {
    const params = withModelConfig(
      { model: {} as any, messages: [] } as any,
      { provider: 'openai-compatible', name: 'Kimi-K2.5', options: { toolMiddleware: 'prompt' } } as any
    );

    await expect(streamTextWithConcurrency(params, fakeContext)).rejects.toThrow(
      /Batch mode cannot replay prompt-mode model 'openai-compatible\/Kimi-K2\.5'/
    );
    // Never reached the batch manager.
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('routes a native tool-calling model through the batch manager unchanged', async () => {
    const params = withModelConfig(
      { model: {} as any, messages: [] } as any,
      { provider: 'openai', name: 'gpt-5', options: {} } as any
    );

    const result = await streamTextWithConcurrency(params, fakeContext);

    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.convertToStepResult).toHaveBeenCalledWith({ id: 'chat-completion' });
    expect(result).toEqual({ steps: ['converted', { id: 'chat-completion' }] });
  });
});
