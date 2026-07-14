/**
 * Tests for Claude Code usage-limit handling at the provider boundary.
 */

import { describe, expect, it } from 'vitest';
import {
  claudeCodeResponseMiddleware,
  guardClaudeCodeQueryUsageLimits,
  isClaudeCodeUsageLimitNotice,
} from '../../../src/utils/models/claude-code-response.js';

const notice = "You've hit your weekly limit · resets Jul 14, 10pm (America/Phoenix)";

/** Build a stream from fixed provider parts. */
function streamFrom(parts: any[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

/** Drain a provider stream. */
async function drain(stream: ReadableStream<any>): Promise<any[]> {
  const parts: any[] = [];
  for await (const part of stream as any) parts.push(part);
  return parts;
}

/** Build a Query whose async iterator is separate from the Query object. */
function queryFrom(messages: any[]): any {
  const iterator = (async function* () {
    for (const message of messages) yield message;
  })();
  return {
    next: iterator.next.bind(iterator),
    return: iterator.return.bind(iterator),
    throw: iterator.throw.bind(iterator),
    [Symbol.asyncIterator]: () => iterator,
  };
}

describe('Claude Code usage-limit handling', () => {
  it('recognizes straight and curly notice introductions', () => {
    expect(isClaudeCodeUsageLimitNotice(notice)).toBe(true);
    expect(isClaudeCodeUsageLimitNotice('You’ve hit your weekly limit')).toBe(true);
    expect(isClaudeCodeUsageLimitNotice('Ordinary model text')).toBe(false);
  });

  it('rejects a raw text-only SDK notice', async () => {
    const query = queryFrom([{
      type: 'assistant',
      message: { content: [{ type: 'text', text: notice }] },
    }]);
    guardClaudeCodeQueryUsageLimits(query);

    await expect(query[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      message: notice,
      isRetryable: false,
    });
  });

  it('closes a rejected raw SDK query exactly once without masking the usage-limit error', async () => {
    const iterator = (async function* () {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: notice }] },
      };
    })();
    const originalReturn = iterator.return.bind(iterator);
    let returnCalls = 0;
    const query: any = {
      next: iterator.next.bind(iterator),
      throw: iterator.throw.bind(iterator),
      async return(value: unknown) {
        returnCalls++;
        if (returnCalls > 1) throw new Error('Query.return called twice');
        return originalReturn(value as any);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    guardClaudeCodeQueryUsageLimits(query);

    await expect(query[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      message: notice,
      isRetryable: false,
    });
    expect(returnCalls).toBe(1);
  });

  it('passes through an ordinary raw SDK message', async () => {
    const message = { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
    const query = queryFrom([message]);
    guardClaudeCodeQueryUsageLimits(query);
    const iterator = query[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: message });
    await iterator.return();
  });

  it('preserves a streamed usage-limit error for the retry layer', async () => {
    const middleware = claudeCodeResponseMiddleware();
    const params: any = { prompt: [], providerOptions: {} };
    const result = await (middleware.wrapStream as any)({
      params,
      doStream: async () => ({ stream: streamFrom([{ type: 'error', error: new Error(notice) }]) }),
    });

    await expect(drain(result.stream)).rejects.toMatchObject({ message: notice, isRetryable: false });
    expect(params.providerOptions.error).toMatchObject({ message: notice, isRetryable: false });
  });

  it('rejects a usage-limit notice returned as streamed text', async () => {
    const middleware = claudeCodeResponseMiddleware();
    const params: any = { prompt: [], providerOptions: {} };
    const result = await (middleware.wrapStream as any)({
      params,
      doStream: async () => ({
        stream: streamFrom([
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: "You've hit " },
          { type: 'text-delta', id: 'text-1', delta: 'your weekly limit · resets Jul 14, 10pm (America/Phoenix)' },
          { type: 'text-end', id: 'text-1' },
        ]),
      }),
    });

    await expect(drain(result.stream)).rejects.toMatchObject({ message: notice, isRetryable: false });
    expect(params.providerOptions.error).toMatchObject({ message: notice, isRetryable: false });
  });

  it('passes through ordinary provider stream parts', async () => {
    const parts = [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'ok' },
      { type: 'text-end', id: 'text-1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} },
    ];
    const middleware = claudeCodeResponseMiddleware();
    const result = await (middleware.wrapStream as any)({
      params: { prompt: [], providerOptions: {} },
      doStream: async () => ({ stream: streamFrom(parts) }),
    });

    expect(await drain(result.stream)).toEqual(parts);
  });
});
