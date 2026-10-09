/**
 * Tests for the Diplomat / Spokesperson tool sets and prompt builders.
 * Agents are resolved through the registry (the canonical load entry) to avoid the
 * circular-import hazard of importing an agent module in isolation; the prompt methods are
 * protected, so we reach them through a loosely-typed handle (as in identity.test.ts).
 * Identity is derived from the typed parameters (live game state) — no live game needed.
 */

import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../../../../src/infra/agent-registry.js';
import type { EnvoyThread } from '../../../../src/types/index.js';
import {
  worldContext,
  noDecisionPower,
  communicationStyle,
  audienceSection,
  diplomatTeammateReporting,
} from '../../../../src/envoy/context/envoy-prompts.js';

const diplomat = agentRegistry.get('diplomat') as any;
const spokesperson = agentRegistry.get('spokesperson') as any;

/**
 * Germany(3) ↔ leader(1) thread; the agent voices seat 3. The voiced seat carries its stored
 * identity (used by getHint via getSelfIdentity); the audience seat is left without one so the
 * default audience description is the bare role.
 */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    player1Identity: { name: 'Rome', leader: 'Caesar' },
    player2Identity: { name: 'Germany', leader: 'Bismarck' },
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    ...partial,
  };
}

const params = { playerID: 3, turn: 5, metadata: { YouAre: { Name: 'Germany', Leader: 'Bismarck' } }, gameStates: {} };

describe('Diplomat tool set', () => {
  it('includes send-message, close-conversation, and the negotiator handoff alongside briefing/events/analyst', () => {
    expect(diplomat.getActiveTools(params)).toEqual([
      'get-briefing',
      'send-message',
      'get-diplomatic-events',
      'call-diplomatic-analyst',
      'close-conversation',
      'call-negotiator',
    ]);
  });
});

describe('Spokesperson tool set', () => {
  it('has briefing/events/send-message but never close-conversation', () => {
    const tools = spokesperson.getActiveTools(params);
    expect(tools).toContain('get-briefing');
    expect(tools).toContain('send-message');
    expect(tools).toContain('get-diplomatic-events');
    expect(tools).not.toContain('close-conversation');
  });
});

describe('Diplomat.getSystem', () => {
  it('includes the resources block in normal mode', async () => {
    const system = await diplomat.getSystem(params, thread(), undefined);
    expect(system).toContain('call-diplomatic-analyst');
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

describe('audience description', () => {
  it('combines the audience role with its stored civ identity', async () => {
    // The audience civ comes from the thread (resolved at open time), e.g. "the leader of Rome".
    const system = await diplomat.getSystem(params, thread(), undefined);
    expect(system).toContain(audienceSection('the leader of Rome'));
  });

  it('is never resolved from live game state', async () => {
    // A civ seeded only in game state must not surface — identity is stored on the thread, so the
    // audience line reflects the thread identity (Rome), never the game-state one (France).
    const identityParams = {
      ...params,
      gameStates: {
        5: { turn: 5, reports: {}, players: { '1': { Civilization: 'France', Leader: 'Napoleon' } } },
      },
    };
    const system = await diplomat.getSystem(identityParams, thread(), undefined);
    expect(system).toContain(audienceSection('the leader of Rome'));
    expect(system).not.toContain('France');
  });
});

describe('Spokesperson.getSystem', () => {
  it('assembles the imported prompt sections by reference', async () => {
    const system = await spokesperson.getSystem(params, thread(), undefined);
    // Imported section constants are included verbatim (by reference), not paraphrased.
    expect(system).toContain(worldContext);
    expect(system).toContain(noDecisionPower);
    expect(system).toContain(communicationStyle);
  });

  it('includes the audienceSection built from the audience role and stored civ', async () => {
    const system = await spokesperson.getSystem(params, thread(), undefined);
    // The thread audience is seat 1 — role "the leader", civ Rome — so "the leader of Rome".
    expect(system).toContain(audienceSection('the leader of Rome'));
  });

  it('includes the stable tool IDs in normal mode', async () => {
    const system = await spokesperson.getSystem(params, thread(), undefined);
    expect(system).toContain('get-briefing');
    expect(system).toContain('get-diplomatic-events');
    expect(system).toContain('send-message');
  });
});

describe('teammate counterpart', () => {
  /** Params whose cached players report puts seats 1 and 3 on the given teams (seat 1 hides its own TeamID). */
  function teamParams(seat3Team: number) {
    return {
      ...params,
      gameStates: {
        5: { turn: 5, reports: {}, players: {
          '1': { Civilization: 'Rome', Leader: 'Caesar' },
          '3': { Civilization: 'Germany', Leader: 'Bismarck', ...(seat3Team === 3 ? {} : { TeamID: seat3Team }) },
        } },
      },
    };
  }

  it('switches the Diplomat to the teammate audience and reporting sections', async () => {
    const system = await diplomat.getSystem(teamParams(1), thread(), undefined);
    expect(system).toContain(audienceSection('the leader of Rome', { civName: 'Rome' }));
    expect(system).toContain(diplomatTeammateReporting);
    expect(system).not.toContain(audienceSection('the leader of Rome'));
  });

  it('keeps the default audience for players on different teams', async () => {
    const system = await diplomat.getSystem(teamParams(3), thread(), undefined);
    expect(system).toContain(audienceSection('the leader of Rome'));
    expect(system).not.toContain(diplomatTeammateReporting);
  });

  it('switches the Spokesperson to the teammate audience without the reporting section', async () => {
    const system = await spokesperson.getSystem(teamParams(1), thread(), undefined);
    expect(system).toContain(audienceSection('the leader of Rome', { civName: 'Rome' }));
    expect(system).not.toContain(diplomatTeammateReporting);
  });
});
