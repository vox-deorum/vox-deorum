/**
 * Tests for the claude-code system-message normalization
 * (`utils/models/providers/claude-code-prompt.ts`). The claude-code provider flattens a prompt keeping only
 * the LAST system message, so these assert the leading system run is merged into one and any later
 * system message is demoted to a user message: `system,system,user,system` becomes
 * `system(1+2),user,user`. A prompt with at most one system message is returned untouched.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeClaudeCodeSystemMessages,
  claudeCodeSystemMiddleware,
} from '../../../../src/utils/models/providers/claude-code-prompt.js';

/** A user message in the v3 provider prompt shape (content is an array of parts). */
const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] });
/** A system message in the v3 provider prompt shape (content is a string). */
const system = (content: string) => ({ role: 'system' as const, content });

describe('normalizeClaudeCodeSystemMessages', () => {
  it('merges the leading system run and demotes a later system to user (system,system,user,system)', () => {
    const out = normalizeClaudeCodeSystemMessages([
      system('S1'),
      system('S2'),
      user('U1'),
      system('S3'),
    ]);
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    // Leading systems merged into one, joined by a blank line.
    expect(out[0]).toEqual({ role: 'system', content: 'S1\n\nS2' });
    // Original user message preserved as-is.
    expect(out[1]).toEqual(user('U1'));
    // The trailing system is demoted to a user message carrying its text.
    expect(out[2]).toEqual({ role: 'user', content: [{ type: 'text', text: 'S3' }] });
  });

  it('leaves a single leading system + user body structurally unchanged', () => {
    const out = normalizeClaudeCodeSystemMessages([system('S1'), user('U1'), user('U2')]);
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    expect(out[0]).toEqual({ role: 'system', content: 'S1' });
    expect(out[1]).toEqual(user('U1'));
    expect(out[2]).toEqual(user('U2'));
  });

  it('returns the same array untouched when there is at most one system message', () => {
    const leadingOnly = [system('S1'), user('U1')];
    expect(normalizeClaudeCodeSystemMessages(leadingOnly)).toBe(leadingOnly);
    // Even a lone TRAILING system message is kept by the provider wherever it sits, so it must
    // not be demoted to a user message.
    const trailingOnly = [user('U1'), system('S1')];
    expect(normalizeClaudeCodeSystemMessages(trailingOnly)).toBe(trailingOnly);
  });

  it('demotes every post-body system individually (no leading system present)', () => {
    const out = normalizeClaudeCodeSystemMessages([user('U1'), system('S1'), system('S2')]);
    expect(out.map((m) => m.role)).toEqual(['user', 'user', 'user']);
    expect(out[1]).toEqual({ role: 'user', content: [{ type: 'text', text: 'S1' }] });
    expect(out[2]).toEqual({ role: 'user', content: [{ type: 'text', text: 'S2' }] });
  });

  it('treats an assistant message as ending the leading run (system after assistant is demoted)', () => {
    const assistant = { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'A1' }] };
    const out = normalizeClaudeCodeSystemMessages([system('S1'), assistant, system('S2')]);
    expect(out.map((m) => m.role)).toEqual(['system', 'assistant', 'user']);
    expect(out[0]).toEqual({ role: 'system', content: 'S1' });
    expect(out[2]).toEqual({ role: 'user', content: [{ type: 'text', text: 'S2' }] });
  });

  it('does not mutate the input prompt', () => {
    const input = [system('S1'), system('S2'), user('U1')];
    const snapshot = JSON.stringify(input);
    normalizeClaudeCodeSystemMessages(input as any);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('claudeCodeSystemMiddleware', () => {
  const run = async (prompt: any) => {
    const mw = claudeCodeSystemMiddleware();
    return (await (mw.transformParams as any)({ params: { prompt } })).prompt;
  };

  it('normalizes a prompt carrying more than one system message', async () => {
    const out = await run([system('S1'), system('S2'), user('U1'), system('S3')]);
    expect(out.map((m: any) => m.role)).toEqual(['system', 'user', 'user']);
    expect(out[0].content).toBe('S1\n\nS2');
  });

  it('is a no-op (returns params untouched) when there is at most one system message', async () => {
    const mw = claudeCodeSystemMiddleware();
    const prompt = [system('S1'), user('U1')];
    const params = { prompt, tools: [] };
    const out = await (mw.transformParams as any)({ params });
    // Same reference back: the trivial case avoids rebuilding the prompt.
    expect(out).toBe(params);
  });

  it('is a no-op for an empty prompt', async () => {
    const mw = claudeCodeSystemMiddleware();
    const params = { prompt: [] };
    expect(await (mw.transformParams as any)({ params })).toBe(params);
  });
});
