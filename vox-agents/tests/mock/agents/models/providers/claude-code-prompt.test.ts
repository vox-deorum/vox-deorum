/**
 * Tests for the claude-code prompt middleware (`agents/models/providers/claude-code-prompt.ts`).
 * The provider sends the whole prompt as one CLI user turn, so every system message must become a
 * user message in place with no merging: `system,system,user,system` becomes `user,user,user,user`.
 * The first two VD cache anchors become Claude Code cache markers.
 */
import { describe, it, expect } from 'vitest';
import {
  claudeCodeCacheMarkers,
  demoteClaudeCodeSystemMessages,
  claudeCodeSystemMiddleware,
  markClaudeCodeCacheAnchors,
} from '../../../../../src/agents/models/providers/claude-code-prompt.js';
import { cacheBreakpoint } from '../../../../../src/agents/models/cache-breakpoint.js';

/** A user message in the provider prompt shape (content is an array of parts). */
const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] });
/** A system message in the provider prompt shape (content is a string). */
const system = (content: string) => ({ role: 'system' as const, content });
/** An assistant message in the provider prompt shape. */
const assistant = (text: string) => ({ role: 'assistant' as const, content: [{ type: 'text' as const, text }] });
/** Adds VD's cache anchor to a prompt message. */
const anchored = <M extends object>(message: M) => ({ ...message, providerOptions: { ...cacheBreakpoint } });
/** The Claude Code cache marker each prompt message carries, if any. */
const markers = (prompt: any[]) => prompt.map((message) => message.providerOptions?.['claude-code']?.cacheControl);

describe('demoteClaudeCodeSystemMessages', () => {
  it('should turn every system message into a user message in place without merging', () => {
    const out = demoteClaudeCodeSystemMessages([system('S1'), system('S2'), user('U1'), system('S3')]);
    expect(out).toEqual([user('S1'), user('S2'), user('U1'), user('S3')]);
  });

  it('should keep assistant messages and their order untouched', () => {
    const out = demoteClaudeCodeSystemMessages([system('S1'), assistant('A1'), system('S2')]);
    expect(out).toEqual([user('S1'), assistant('A1'), user('S2')]);
  });

  it('should return the same array when there is no system message', () => {
    const input = [user('U1'), assistant('A1')];
    expect(demoteClaudeCodeSystemMessages(input)).toBe(input);
  });

  it('should keep the provider options of a demoted system message', () => {
    const out = demoteClaudeCodeSystemMessages([anchored(system('S1')), user('U1')]);
    expect(out[0]).toEqual(anchored(user('S1')));
  });

  it('should not mutate the input prompt', () => {
    const input = [system('S1'), user('U1')];
    const snapshot = JSON.stringify(input);
    demoteClaudeCodeSystemMessages(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('markClaudeCodeCacheAnchors', () => {
  it('should mark only the first two anchored user messages', () => {
    const out = markClaudeCodeCacheAnchors([user('U0'), anchored(user('U1')), anchored(user('U2')), anchored(user('U3'))]);
    const { cacheControl } = claudeCodeCacheMarkers;
    expect(markers(out)).toEqual([undefined, cacheControl, cacheControl, undefined]);
    expect(out[1].providerOptions?.anthropic).toEqual(cacheBreakpoint.anthropic);
  });

  it('should skip anchors on assistant messages, which the provider cannot mark', () => {
    const out = markClaudeCodeCacheAnchors([anchored(assistant('A1')), anchored(user('U1'))]);
    expect(markers(out)).toEqual([undefined, claudeCodeCacheMarkers.cacheControl]);
  });

  it('should return the same prompt when nothing is anchored', () => {
    const input = [user('U1'), assistant('A1')];
    expect(markClaudeCodeCacheAnchors(input)).toBe(input);
  });
});

describe('claudeCodeSystemMiddleware', () => {
  /** Runs the middleware's transformParams on the given params. */
  const run = async (params: any) => {
    const mw = claudeCodeSystemMiddleware();
    return (mw.transformParams as any)({ params });
  };

  it('should demote system messages in the outgoing prompt', async () => {
    const out = await run({ prompt: [system('S1'), user('U1')] });
    expect(out.prompt).toEqual([user('S1'), user('U1')]);
  });

  it('should mark anchored system messages after demoting them', async () => {
    const out = await run({ prompt: [system('S1'), anchored(system('S2')), user('U1')] });
    expect(out.prompt.map((message: any) => message.role)).toEqual(['user', 'user', 'user']);
    expect(markers(out.prompt)).toEqual([undefined, claudeCodeCacheMarkers.cacheControl, undefined]);
  });

  it('should return params untouched for an empty prompt or one without system messages', async () => {
    const empty = { prompt: [] };
    expect(await run(empty)).toBe(empty);
    const params = { prompt: [user('U1')], tools: [] };
    expect(await run(params)).toBe(params);
  });
});
