/**
 * Tests for the Diplomat / Spokesperson tool sets and prompt builders.
 * Agents are resolved through the registry (the canonical load entry) to avoid the
 * circular-import hazard of importing an agent module in isolation; the prompt methods are
 * protected, so we reach them through a loosely-typed handle (as in identity.test.ts).
 * Identity is derived from the typed parameters (live game state) — no live game needed.
 */

import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../../src/infra/agent-registry.js';
import type { EnvoyThread } from '../../src/types/index.js';

const diplomat = agentRegistry.get('diplomat') as any;
const spokesperson = agentRegistry.get('spokesperson') as any;

/** Germany(3) ↔ leader(1) thread; the agent voices seat 3. */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    ...partial,
  };
}

/** A thread whose last message is the {{{Greeting}}} special trigger. */
function greetingThread(): EnvoyThread {
  return thread({
    messages: [{ message: { role: 'user', content: '{{{Greeting}}}' }, metadata: { datetime: new Date(0), turn: 5 } }],
  });
}

const params = { playerID: 3, turn: 5, metadata: { YouAre: { Name: 'Germany', Leader: 'Bismarck' } }, gameStates: {} };

describe('Diplomat tool set', () => {
  it('includes close-conversation alongside the briefing/events/analyst tools', () => {
    expect(diplomat.getActiveTools(params)).toEqual([
      'get-briefing',
      'get-diplomatic-events',
      'call-diplomatic-analyst',
      'close-conversation',
    ]);
  });
});

describe('Spokesperson tool set', () => {
  it('has briefing/events but never close-conversation', () => {
    const tools = spokesperson.getActiveTools(params);
    expect(tools).toContain('get-briefing');
    expect(tools).toContain('get-diplomatic-events');
    expect(tools).not.toContain('close-conversation');
  });
});

describe('Diplomat.getSystem', () => {
  it('includes the resources block in normal mode', async () => {
    const system = await diplomat.getSystem(params, thread(), undefined);
    expect(system).toContain('# Your Resources');
    expect(system).toContain('call-diplomatic-analyst');
    expect(system).toContain('# Your Audience');
  });

  it('omits the resources block in special (greeting) mode', async () => {
    const system = await diplomat.getSystem(params, greetingThread(), undefined);
    expect(system).not.toContain('# Your Resources');
  });
});

describe('getHint', () => {
  it('Diplomat anchors on self civ/leader, audience, and turn', () => {
    const hint = diplomat.getHint(params, thread());
    expect(hint).toContain('Germany');
    expect(hint).toContain('Bismarck');
    expect(hint).toContain('the leader'); // audience role
    expect(hint).toContain('turn 5');
  });

  it('Spokesperson anchors on self civ/leader', () => {
    const hint = spokesperson.getHint(params, thread());
    expect(hint).toContain('Germany');
    expect(hint).toContain('Bismarck');
  });
});
