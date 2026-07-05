/**
 * Mock-tier unit tests for `hasOnlyTerminalCalls` and `getValidCalls` (terminal-tools).
 *
 * Focuses on the provider-executed and invalid-call exclusions: the host CLI's own
 * tool calls (e.g. claude-code's Read, marked providerExecuted) and never-executed
 * invalid calls (marked invalid) must not affect the game-turn terminal decision.
 * Terminal-ness of game tools is derived from the MCP readOnlyHint annotation
 * (readOnlyHint:false = write/action = terminal; readOnlyHint:true = read-only =
 * non-terminal).
 */

import { describe, expect, it } from 'vitest';
import {
  getValidCalls,
  hasOnlyTerminalCalls,
  formatToolChoiceList,
  buildRequiredToolsNudge,
} from '../../../src/utils/tools/terminal-tools.js';

const mcpToolMap = new Map<string, any>([
  ['end_turn', { name: 'end_turn', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } }],
  ['look', { name: 'look', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
]);

describe('hasOnlyTerminalCalls', () => {
  it('returns true for a step with no tool calls (final-answer backstop)', () => {
    expect(hasOnlyTerminalCalls({ toolCalls: [] }, mcpToolMap as any)).toBe(true);
  });

  it('returns true when every game call is terminal', () => {
    expect(hasOnlyTerminalCalls({ toolCalls: [{ toolName: 'end_turn' }] }, mcpToolMap as any)).toBe(true);
  });

  it('returns false when a game call is non-terminal', () => {
    expect(hasOnlyTerminalCalls({ toolCalls: [{ toolName: 'look' }] }, mcpToolMap as any)).toBe(false);
  });

  it('ignores a provider-executed built-in call alongside a terminal game action', () => {
    // Without the exclusion, the non-terminal Read would read as non-terminal and force
    // another step, risking a repeat of end_turn's side effects.
    const step = { toolCalls: [
      { toolName: 'end_turn' },
      { toolName: 'Read', providerExecuted: true },
    ] };
    expect(hasOnlyTerminalCalls(step, mcpToolMap as any)).toBe(true);
  });

  it('treats a host-only step (provider-executed calls only) as terminal', () => {
    const step = { toolCalls: [{ toolName: 'Read', providerExecuted: true }] };
    expect(hasOnlyTerminalCalls(step, mcpToolMap as any)).toBe(true);
  });

  it('ignores an invalid call alongside a terminal game action', () => {
    // An invalid call never executes; it must not read as non-terminal and force
    // another step after the terminal action already ran.
    const step = { toolCalls: [
      { toolName: 'end_turn' },
      { toolName: 'no_such_tool', invalid: true },
    ] };
    expect(hasOnlyTerminalCalls(step, mcpToolMap as any)).toBe(true);
  });
});

describe('getValidCalls', () => {
  it('filters out invalid calls and keeps the rest', () => {
    const step = { toolCalls: [
      { toolName: 'end_turn' },
      { toolName: 'look', invalid: false },
      { toolName: 'no_such_tool', invalid: true },
    ] };
    expect(getValidCalls(step).map(c => c.toolName)).toEqual(['end_turn', 'look']);
  });

  it('returns an empty array for a step with only invalid calls', () => {
    const step = { toolCalls: [{ toolName: 'garbled', invalid: true }] };
    expect(getValidCalls(step)).toEqual([]);
  });
});

describe('formatToolChoiceList', () => {
  it('returns undefined for an empty list', () => {
    expect(formatToolChoiceList([])).toBeUndefined();
  });

  it('backtick-quotes a single name with no conjunction', () => {
    expect(formatToolChoiceList(['a'])).toBe('`a`');
  });

  it('joins two names with "or" and no comma', () => {
    expect(formatToolChoiceList(['a', 'b'])).toBe('`a` or `b`');
  });

  it('uses an Oxford comma for three or more names', () => {
    expect(formatToolChoiceList(['a', 'b', 'c'])).toBe('`a`, `b`, or `c`');
  });

  it('passes hyphenated tool names through verbatim inside the backticks', () => {
    expect(formatToolChoiceList(['accept-deal', 'propose-deal', 'reject-deal']))
      .toBe('`accept-deal`, `propose-deal`, or `reject-deal`');
  });
});

describe('buildRequiredToolsNudge', () => {
  it('returns undefined for an empty list so the injection site skips', () => {
    expect(buildRequiredToolsNudge([])).toBeUndefined();
  });

  it('wraps the formatted list in the finalize reminder', () => {
    expect(buildRequiredToolsNudge(['accept-deal', 'propose-deal', 'reject-deal']))
      .toBe('Make sure to call `accept-deal`, `propose-deal`, or `reject-deal` with the exact provided format to finalize your decisions.');
  });
});
