/**
 * Tests for the set-persona action tool. The Lua boundary is stubbed (no bridge); the
 * post-processing — clamping to 1-10, the previous/new PersonaChanges store writes,
 * the change detection, and the replay push — runs for real against an in-memory
 * KnowledgeStore. set-persona has no game-enum dependency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import createSetPersonaTool from '../../../src/tools/actions/set-persona.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

const tool = createSetPersonaTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupStore(10);
  client = await connectToolClient(tool);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
  await store.close();
});

/** All persona columns are NOT NULL in the schema, so GetPersona() returns the full set. */
const PERSONA_FIELDS = [
  'VictoryCompetitiveness', 'WonderCompetitiveness', 'MinorCivCompetitiveness', 'Boldness',
  'WarBias', 'HostileBias', 'WarmongerHate', 'NeutralBias', 'FriendlyBias', 'GuardedBias', 'AfraidBias',
  'DiplomaticBalance', 'Friendliness', 'WorkWithWillingness', 'WorkAgainstWillingness', 'Loyalty',
  'MinorCivFriendlyBias', 'MinorCivNeutralBias', 'MinorCivHostileBias', 'MinorCivWarBias',
  'DenounceWillingness', 'Forgiveness', 'Meanness', 'Neediness', 'Chattiness', 'DeceptiveBias',
];

/** Build a complete persona (all fields = base) with optional overrides, mirroring GetPersona(). */
function fullPersona(overrides: Record<string, number> = {}, base = 5): Record<string, number> {
  const persona: Record<string, number> = {};
  for (const field of PERSONA_FIELDS) persona[field] = base;
  return { ...persona, ...overrides };
}

/** Stub the Lua boundary so super.call() returns a canned (complete) "previous persona". */
function mockLua(previousPersona: unknown) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
    success: true,
    result: previousPersona,
  } as any);
}

describe('set-persona', () => {
  it.each([1, 10])('accepts the documented persona endpoint %i through MCP', async (value) => {
    mockLua(fullPersona());

    const result = await client.call({ PlayerID: 0, Boldness: value, Rationale: 'Endpoint value' });

    expect(result.Success).toBe(true);
    const latest = await store.getMutableKnowledge('PersonaChanges', 0);
    expect(latest?.Boldness).toBe(value);
  });

  it('writes previous + new versions, clamps values, and stamps the turn', async () => {
    mockLua(fullPersona({ Boldness: 3, WarBias: 5 }));

    await client.call({
      PlayerID: 0,
      Boldness: 99, // clamps to 10
      WarBias: 7,
      Rationale: 'Get aggressive',
    });

    const history = await store.getMutableKnowledgeHistory('PersonaChanges', 0);
    expect(history.map((h) => h.Version)).toEqual([2, 1]);

    // v1 = the previous persona values.
    const previous = history.find((h) => h.Version === 1)!;
    expect(previous.Boldness).toBe(3);
    expect(previous.WarBias).toBe(5);

    // v2 = new values merged over previous, clamped, with the trimmed caller rationale.
    const latest = history.find((h) => h.Version === 2)!;
    expect(latest.Boldness).toBe(10); // clamped from 99
    expect(latest.WarBias).toBe(7);
    expect(latest.Rationale).toBe('Get aggressive');
    expect(latest.Turn).toBe(10);
  });

  it('writes PersonaChanges visible only to the acting player', async () => {
    mockLua(fullPersona({ Boldness: 3 }));

    await client.call({ PlayerID: 0, Boldness: 6, Rationale: 'r' });

    expect(await store.getMutableKnowledge('PersonaChanges', 0, 0)).not.toBeUndefined();
    expect(await store.getMutableKnowledge('PersonaChanges', 0, 1)).toBeUndefined();
  });

  it('does no store write or push when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await client.call({ PlayerID: 0, Boldness: 8, Rationale: 'r' });
    expect(result.Success).toBe(false);
    expect(await store.getMutableKnowledgeHistory('PersonaChanges', 0)).toHaveLength(0);
  });

  it('still applies the change when the previous persona comes back empty', async () => {
    mockLua([]);

    const result = await client.call({ PlayerID: 0, Boldness: 8, Rationale: 'r' });
    expect(result.Success).toBe(true);
    // Without a complete previous persona no history row can be written.
    expect(await store.getMutableKnowledgeHistory('PersonaChanges', 0)).toHaveLength(0);
  });
});
