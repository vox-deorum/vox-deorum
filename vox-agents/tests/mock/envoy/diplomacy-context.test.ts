/**
 * Tests for the diplomat/negotiator background builder (src/envoy/utils/diplomacy-context.ts):
 * buildDiplomacyBackgroundMessage assembles three perspective-aware sections (the two civs' cities,
 * the standing in-game deals between them, and their recently-concluded deals), degrading each
 * independently and skipping minor-civ counterparts entirely. Drives it through a stub context whose
 * callTool returns canned per-tool reports; no live game / LLM.
 */

import { describe, it, expect, vi } from 'vitest';
import type { EnvoyThread } from '../../../src/types/index.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

// Load the full agent graph through the registry BEFORE importing an envoy module in isolation,
// otherwise vox-agent -> vox-context -> agent-registry re-enters vox-agent mid-evaluation (the same
// circular-import hazard guarded in negotiator.test / diplomat-prompts.test).
import '../../../src/infra/agent-registry.js';
import { buildDiplomacyBackgroundMessage } from '../../../src/envoy/utils/diplomacy-context.js';
import { MINOR_CIV_LEADER } from '../../../../mcp-server/dist/knowledge/schema/base.js';

/** Diplomacy thread: ordered pair 1↔3, the envoy voices seat 3 (Germany), counterpart is seat 1 (Rome). */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'negotiator',
    player1Identity: { name: 'Rome', leader: 'Augustus Caesar' },
    player2Identity: { name: 'Germany', leader: 'Bismarck' },
    diplomacy: true,
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    ...partial,
  };
}

/** A context stub whose callTool resolves each tool by name from a canned map (undefined = failed fetch). */
function makeContext(responses: Record<string, unknown>) {
  const callTool = vi.fn(async (name: string) => responses[name]);
  return { context: { callTool } as any, callTool };
}

const params = { turn: 20, playerID: 3 } as any;

/** get-cities is keyed by civ SHORT NAME (not leader): the regression this builder once got wrong. */
const cities = {
  Germany: { Berlin: { Population: 5 } },
  Rome: { RomeCity: { Population: 3 } },
};

/** get-players is keyed by player-ID string; standing deals live on the viewer's own row by counterpart civ. */
const players = {
  '3': {
    DiplomaticDeals: {
      Rome: [{ TurnsRemaining: 12, WeGive: ['Open Borders'], TheyGive: ['Gold: 100'] }],
    },
  },
};

/** get-diplomatic-events (unformatted) is turn-keyed; a DealMade between the pair, viewer (3) as From. */
const events = {
  '18': [
    { Type: 'DealMade', FromPlayerID: 3, ToPlayerID: 1, FromGives: ['Gold: 50'], ToGives: ['Open Borders'], StartTurn: 18, TurnsRemaining: 30 },
  ],
};

describe('buildDiplomacyBackgroundMessage', () => {
  it('renders all three sections, keying cities by civ name and deals viewer-first', async () => {
    const { context } = makeContext({ 'get-cities': cities, 'get-players': players, 'get-diplomatic-events': events });

    const out = await buildDiplomacyBackgroundMessage(context, params, thread());

    expect(out).toContain('# Cities & Diplomatic Standing (with Rome)');
    // Cities: keyed by short name (Germany/Rome), NOT leader (Bismarck/Augustus Caesar).
    expect(out).toContain('## Your cities (Germany)');
    expect(out).toContain('Berlin');
    expect(out).toContain("## Rome's cities (visible)");
    expect(out).not.toContain('Bismarck');
    expect(out).not.toContain('Augustus Caesar');
    // Standing deal, viewer (Germany) first.
    expect(out).toContain('Standing agreements currently in force with Rome');
    expect(out).toContain('Deal: **Germany** gives [Open Borders] ↔ **Rome** gives [Gold: 100] (12 turns remaining)');
    // Concluded deal: viewer is the From side, so its FromGives are the "we give" column, expiry derived.
    expect(out).toContain('Recently concluded deals with Rome');
    expect(out).toContain('turn 18: Deal: **Germany** gives [Gold: 50] ↔ **Rome** gives [Open Borders] (will expire at turn 48)');
  });

  it('returns undefined for a minor-civ counterpart without fetching anything', async () => {
    const { context, callTool } = makeContext({ 'get-cities': cities, 'get-players': players, 'get-diplomatic-events': events });
    const minorThread = thread({ player1Identity: { name: 'Venice', leader: MINOR_CIV_LEADER } });

    const out = await buildDiplomacyBackgroundMessage(context, params, minorThread);

    expect(out).toBeUndefined();
    expect(callTool).not.toHaveBeenCalled();
  });

  it('returns undefined when every section is empty', async () => {
    const { context } = makeContext({ 'get-cities': {}, 'get-players': {}, 'get-diplomatic-events': {} });
    expect(await buildDiplomacyBackgroundMessage(context, params, thread())).toBeUndefined();
  });

  it('degrades each section independently when a fetch fails (returns undefined)', async () => {
    // Cities and events fetches fail; only standing deals survive.
    const { context } = makeContext({ 'get-cities': undefined, 'get-players': players, 'get-diplomatic-events': undefined });

    const out = await buildDiplomacyBackgroundMessage(context, params, thread());

    expect(out).toContain('Standing agreements currently in force with Rome');
    expect(out).not.toContain('Your cities');
    expect(out).not.toContain('Recently concluded deals');
  });

  it('excludes the counterpart\'s deals with third parties and flips direction when the viewer is the To side', async () => {
    const mixedEvents = {
      '15': [
        // Between the pair, but viewer (3) is the To side → its ToGives are the "we give" column.
        { Type: 'DealMade', FromPlayerID: 1, ToPlayerID: 3, FromGives: ['Open Borders'], ToGives: ['Gold: 25'] },
        // Counterpart (1) with a THIRD party (5): server visibility admits it, the pair re-filter drops it.
        { Type: 'DealMade', FromPlayerID: 1, ToPlayerID: 5, FromGives: ['Secret pact'], ToGives: ['Tribute'] },
      ],
    };
    const { context } = makeContext({ 'get-cities': {}, 'get-players': {}, 'get-diplomatic-events': mixedEvents });

    const out = await buildDiplomacyBackgroundMessage(context, params, thread());

    expect(out).toContain('turn 15: Deal: **Germany** gives [Gold: 25] ↔ **Rome** gives [Open Borders]');
    expect(out).not.toContain('Secret pact');
    expect(out).not.toContain('Tribute');
  });

  it('caps the concluded-deals list at the 10 most recent', async () => {
    // 12 deals across turns 1..12; only turns 3..12 should survive the tail cap.
    const many: Record<string, unknown[]> = {};
    for (let turn = 1; turn <= 12; turn++) {
      many[String(turn)] = [
        { Type: 'DealMade', FromPlayerID: 3, ToPlayerID: 1, FromGives: [`Gold: ${turn}`], ToGives: ['Open Borders'] },
      ];
    }
    const { context } = makeContext({ 'get-cities': {}, 'get-players': {}, 'get-diplomatic-events': many });

    const out = await buildDiplomacyBackgroundMessage(context, params, thread());

    expect(out!.split('- turn ').length - 1).toBe(10);
    expect(out).not.toContain('- turn 1:');
    expect(out).not.toContain('- turn 2:');
    expect(out).toContain('- turn 12:');
  });
});
