/**
 * Tests for the set-persona action tool. The Lua boundary is stubbed (no bridge); the
 * post-processing — clamping to 1-10, the previous/new PersonaChanges store writes,
 * the change detection, and the replay push — runs for real against an in-memory
 * KnowledgeStore. set-persona has no game-enum dependency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import * as playerActions from '../../../src/utils/lua/player-actions.js';
import createSetPersonaTool from '../../../src/tools/actions/set-persona.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createSetPersonaTool();
let store: KnowledgeStore;
let pushSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  store = await setupStore(10);
  pushSpy = vi.spyOn(playerActions, 'pushPlayerAction').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
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
function mockLua(previousPersona: Record<string, number>) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
    success: true,
    result: previousPersona,
  } as any);
}

describe('set-persona', () => {
  describe('schema validation', () => {
    it('rejects a PlayerID below 0', () => {
      const parsed = tool.inputSchema.safeParse({ PlayerID: -1, Rationale: 'r' });
      expect(parsed.success).toBe(false);
    });

    it('requires a Rationale', () => {
      const parsed = tool.inputSchema.safeParse({ PlayerID: 0 });
      expect(parsed.success).toBe(false);
    });

    it('accepts a valid payload and defaults Turn to -1', () => {
      const parsed = tool.inputSchema.safeParse({ PlayerID: 0, Boldness: 8, Rationale: 'r' });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.Turn).toBe(-1);
    });
  });

  it('writes previous + new versions, clamps values, and stamps the turn', async () => {
    mockLua(fullPersona({ Boldness: 3, WarBias: 5 }));

    await tool.execute({
      PlayerID: 0,
      Boldness: 99, // clamps to 10
      WarBias: 7,
      Rationale: 'Get aggressive',
    } as any);

    const history = await store.getMutableKnowledgeHistory('PersonaChanges', 0);
    expect(history.map((h) => h.Version)).toEqual([2, 1]);

    // v1 = previous persona, rationale wrapped as "Tweaked by In-Game AI(...)".
    const previous = history.find((h) => h.Version === 1)!;
    expect(previous.Boldness).toBe(3);
    expect(previous.WarBias).toBe(5);
    expect(previous.Rationale).toMatch(/^Tweaked by In-Game AI/);

    // v2 = new values merged over previous, clamped, with the trimmed caller rationale.
    const latest = history.find((h) => h.Version === 2)!;
    expect(latest.Boldness).toBe(10); // clamped from 99
    expect(latest.WarBias).toBe(7);
    expect(latest.Rationale).toBe('Get aggressive');
    expect(latest.Turn).toBe(10);
  });

  it('writes PersonaChanges visible only to the acting player', async () => {
    mockLua(fullPersona({ Boldness: 3 }));

    await tool.execute({ PlayerID: 0, Boldness: 6, Rationale: 'r' } as any);

    expect(await store.getMutableKnowledge('PersonaChanges', 0, 0)).not.toBeUndefined();
    expect(await store.getMutableKnowledge('PersonaChanges', 0, 1)).toBeUndefined();
  });

  it('pushes a replay action describing only the changed fields', async () => {
    mockLua(fullPersona({ Boldness: 3, WarBias: 5 }));

    await tool.execute({ PlayerID: 0, Boldness: 8, WarBias: 5, Rationale: 'tune' } as any);

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const [playerID, actionType, summary, rationale, prefix, turn] = pushSpy.mock.calls[0];
    expect(playerID).toBe(0);
    expect(actionType).toBe('persona');
    expect(prefix).toBe('Diplomatic persona');
    expect(rationale).toBe('tune');
    expect(turn).toBe(10);
    expect(summary).toContain('Boldness: 3 → 8');
    expect(summary).not.toContain('WarBias'); // unchanged field omitted
  });

  it('does not push a replay action when nothing actually changed', async () => {
    mockLua(fullPersona({ Boldness: 4 }));

    await tool.execute({ PlayerID: 0, Boldness: 4, Rationale: 'noop' } as any);

    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('does no store write or push when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await tool.execute({ PlayerID: 0, Boldness: 8, Rationale: 'r' } as any);
    expect(result.Success).toBe(false);
    expect(await store.getMutableKnowledgeHistory('PersonaChanges', 0)).toHaveLength(0);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
