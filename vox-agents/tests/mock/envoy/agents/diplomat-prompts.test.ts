/**
 * Tests for the Diplomat / Spokesperson tool sets and prompt builders.
 * Agents are resolved through the registry (the canonical load entry) to avoid the
 * circular-import hazard of importing an agent module in isolation; the prompt methods are
 * protected, so we reach them through a loosely-typed handle (as in identity.test.ts).
 * Audience identity comes from the persisted thread; teammate status comes from cached game state.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, it, expect } from 'vitest';
import { agentRegistry } from '../../../../src/infra/agent-registry.js';
import type { EnvoyThread } from '../../../../src/types/index.js';

const diplomat = agentRegistry.get('diplomat') as any;
const spokesperson = agentRegistry.get('spokesperson') as any;

const promptFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-diplomat-prompts-'));
const sharedPromptFolder = path.join(promptFolder, 'shared');
fs.mkdirSync(sharedPromptFolder);
fs.writeFileSync(
  path.join(sharedPromptFolder, 'audience.md'),
  `CONTROLLED-AUDIENCE: {{user}}
{{#teammate}}CONTROLLED-TEAMMATE: {{civName}}{{/teammate}}{{^teammate}}CONTROLLED-NO-TEAMMATE{{/teammate}}
`,
);
const promptContext = { prompts: promptFolder } as any;

/** Remove the temporary custom prompt fixture after the audience tests finish. */
afterAll(() => fs.rmSync(promptFolder, { recursive: true, force: true }));

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
    const input = thread({
      player1Role: 'envoy-from-seat-1',
      player1Identity: { name: 'StoredAudienceCiv-314', leader: 'StoredAudienceLeader-271' },
    });
    const system = await diplomat.getSystem(params, input, promptContext);
    expect(system).toContain('CONTROLLED-AUDIENCE: envoy-from-seat-1 of StoredAudienceCiv-314');
    expect(system).toContain('CONTROLLED-NO-TEAMMATE');
  });

  it('is never resolved from live game state', async () => {
    const identityParams = {
      ...params,
      gameStates: {
        5: { turn: 5, reports: {}, players: { '1': { Civilization: 'GameStateCiv-963', Leader: 'GameStateLeader-852' } } },
      },
    };
    const input = thread({ player1Identity: { name: 'ThreadCiv-741', leader: 'ThreadLeader-630' } });
    const system = await diplomat.getSystem(identityParams, input, promptContext);
    expect(system).toContain('CONTROLLED-AUDIENCE: the leader of ThreadCiv-741');
    expect(system).not.toContain('GameStateCiv-963');
    expect(system).not.toContain('GameStateLeader-852');
  });
});

describe('Spokesperson.getSystem', () => {
  it('uses the audience role and stored civ identity', async () => {
    const input = thread({
      player1Role: 'voice-from-seat-1',
      player1Identity: { name: 'SpokespersonAudience-528', leader: 'SpokespersonLeader-417' },
    });
    const system = await spokesperson.getSystem(params, input, promptContext);
    expect(system).toContain('CONTROLLED-AUDIENCE: voice-from-seat-1 of SpokespersonAudience-528');
    expect(system).toContain('CONTROLLED-NO-TEAMMATE');
  });

  it('includes the stable tool IDs in normal mode', async () => {
    const system = await spokesperson.getSystem(params, thread(), undefined);
    expect(system).toContain('get-briefing');
    expect(system).toContain('get-diplomatic-events');
    expect(system).toContain('send-message');
  });
});

describe('teammate counterpart', () => {
  /** Build cached player reports for the requested team relation. */
  function teamParams(seat3Team: number) {
    return {
      ...params,
      gameStates: {
        5: { turn: 5, reports: {}, players: {
          '1': { Civilization: 'GameStateAudience-194', Leader: 'GameStateAudienceLeader-183' },
          '3': { Civilization: 'GameStateAgent-372', Leader: 'GameStateAgentLeader-361', ...(seat3Team === 3 ? {} : { TeamID: seat3Team }) },
        } },
      },
    };
  }

  /** Build a thread whose persisted identities conflict with the cached game-state names. */
  function teamThread(): EnvoyThread {
    return thread({
      player1Identity: { name: 'StoredCounterpart-936', leader: 'StoredCounterpartLeader-825' },
      player2Identity: { name: 'StoredAgent-714', leader: 'StoredAgentLeader-603' },
    });
  }

  it('includes the stored counterpart identity when cached players share a team', async () => {
    const system = await diplomat.getSystem(teamParams(1), teamThread(), promptContext);
    expect(system).toContain('CONTROLLED-AUDIENCE: the leader of StoredCounterpart-936');
    expect(system).toContain('CONTROLLED-TEAMMATE: StoredCounterpart-936');
    expect(system).not.toContain('GameStateAudience-194');
  });

  it('omits teammate context for players on different teams', async () => {
    const system = await diplomat.getSystem(teamParams(3), teamThread(), promptContext);
    expect(system).toContain('CONTROLLED-AUDIENCE: the leader of StoredCounterpart-936');
    expect(system).toContain('CONTROLLED-NO-TEAMMATE');
    expect(system).not.toContain('CONTROLLED-TEAMMATE:');
  });

  it('includes the stored counterpart identity for a Spokesperson addressing a teammate', async () => {
    const system = await spokesperson.getSystem(teamParams(1), teamThread(), promptContext);
    expect(system).toContain('CONTROLLED-AUDIENCE: the leader of StoredCounterpart-936');
    expect(system).toContain('CONTROLLED-TEAMMATE: StoredCounterpart-936');
    expect(system).not.toContain('GameStateAudience-194');
  });
});
