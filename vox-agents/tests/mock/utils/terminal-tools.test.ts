/**
 * Mock-tier unit tests for `hasOnlyTerminalCalls` (terminal-tools).
 *
 * Focuses on the provider-executed exclusion: the host CLI's own tool calls
 * (e.g. claude-code's Read, marked providerExecuted) must not affect the
 * game-turn terminal decision. Terminal-ness of game tools is derived from
 * the MCP readOnlyHint annotation (readOnlyHint:false = write/action = terminal;
 * readOnlyHint:true = read-only = non-terminal).
 */

import { describe, expect, it } from 'vitest';
import { hasOnlyTerminalCalls } from '../../../src/utils/tools/terminal-tools.js';

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
});
