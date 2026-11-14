/** Tests for the cache breakpoint marker helpers shared by agent prompts. */

import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  cacheBreakpoint,
  countCacheBreakpoints,
  hasCacheBreakpoint,
  markBreakpointOnLast,
} from '../../../../src/agents/models/cache-breakpoint.js';

/** Build an unmarked user message. */
function user(content: string): ModelMessage {
  return { role: 'user', content };
}

/** Build a user message that already carries the given provider options. */
function userWithOptions(content: string, providerOptions: Record<string, unknown>): ModelMessage {
  return { role: 'user', content, providerOptions } as ModelMessage;
}

/** Build a user message already carrying the shared cache breakpoint, as a caller would mark one. */
function markedUser(content: string): ModelMessage {
  return { role: 'user', content, providerOptions: { ...cacheBreakpoint } } as ModelMessage;
}

describe('markBreakpointOnLast', () => {
  it('should mark only the last message', () => {
    const messages = [user('first'), user('second'), user('third')];
    markBreakpointOnLast(messages);
    expect(hasCacheBreakpoint(messages[2])).toBe(true);
    expect(hasCacheBreakpoint(messages[0])).toBe(false);
    expect(hasCacheBreakpoint(messages[1])).toBe(false);
  });

  it('should keep the last message\'s existing provider options', () => {
    const openaiOption = { store: true };
    const messages = [userWithOptions('last', { openai: openaiOption })];
    markBreakpointOnLast(messages);
    expect(messages[0].providerOptions?.openai).toEqual(openaiOption);
    expect(hasCacheBreakpoint(messages[0])).toBe(true);
  });

  it('should not mutate the original last message object', () => {
    const original = user('last');
    const messages = [user('first'), original];
    markBreakpointOnLast(messages);
    expect(original.providerOptions).toBeUndefined();
    expect(messages[1]).not.toBe(original);
    expect(messages[1].content).toBe('last');
  });

  it('should be a no-op on an empty message list', () => {
    const messages: ModelMessage[] = [];
    expect(() => markBreakpointOnLast(messages)).not.toThrow();
    expect(messages).toHaveLength(0);
  });

  it('should attach the shared cacheBreakpoint marker', () => {
    const messages = [user('only')];
    markBreakpointOnLast(messages);
    expect(messages[0].providerOptions?.anthropic).toEqual(cacheBreakpoint.anthropic);
  });
});

describe('countCacheBreakpoints', () => {
  it('should count every marked message', () => {
    const messages = [markedUser('a'), user('b'), user('c')];
    markBreakpointOnLast(messages);
    expect(countCacheBreakpoints(messages)).toBe(2);
  });

  it('should return zero when no message carries a breakpoint', () => {
    expect(countCacheBreakpoints([user('a'), user('b')])).toBe(0);
    expect(countCacheBreakpoints([])).toBe(0);
  });
});
