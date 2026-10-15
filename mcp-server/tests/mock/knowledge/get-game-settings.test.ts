/**
 * Tests for the get-game-settings YouAre block. PlayerInformations rows come from a real
 * in-memory KnowledgeStore; the Lua call and the civilization summary lookup are stubbed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The civilization summaries need the game database; stub the tool lookup boundary.
vi.mock('../../../src/tools/index.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getTool: vi.fn(() => ({
      getSummaries: async () => ['Rome', 'Greece', 'Egypt', 'Venice'].map(Name => ({ Name, Type: `CIV_${Name}`, Leader: `${Name} Leader` })),
    })),
  };
});

import { setupStore, seedPlayer } from '../helpers.js';
import createGetGameSettingsTool from '../../../src/tools/knowledge/get-game-settings.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

/** Build a tool whose Lua call returns fixed static settings. */
function createTool() {
  const tool = createGetGameSettingsTool();
  vi.spyOn(tool as any, 'call').mockImplementation(async () => ({ Success: true, Result: {
    GameSpeed: 'Standard', MapType: 'Assets\\Maps\\Continents.lua', MapSize: 'Small',
    Difficulty: 'Prince', StartEra: 'Ancient', MaxTurns: 500, VictoryTypes: ['Domination'],
  } }));
  return tool;
}

beforeEach(async () => {
  store = await setupStore(10);
  await seedPlayer(store, 0, { civilization: 'Rome', leader: 'Augustus Caesar', teamID: 0 });
  await seedPlayer(store, 1, { civilization: 'Greece', leader: 'Alexander', teamID: 0 });
  await seedPlayer(store, 2, { civilization: 'Egypt', leader: 'Ramesses II', teamID: 2 });
  await seedPlayer(store, 3, { civilization: 'Venice', leader: 'Enrico Dandolo', teamID: 0, isMajor: 0 });
  client = await connectToolClient(createTool());
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
  await store.close();
});

describe('get-game-settings YouAre', () => {
  it('lists other major civilizations on the same team as permanent teammates', async () => {
    const result = await client.call({ PlayerID: 0 });
    expect(result.Result.YouAre.PlayerID).toBe(0);
    expect(result.Result.YouAre.PermanentTeammates).toHaveLength(1);
    expect(result.Result.YouAre.PermanentTeammates[0]).toContain('Greece');
  });

  it('omits permanent teammates for a player alone on its team', async () => {
    const result = await client.call({ PlayerID: 2 });
    expect(result.Result.YouAre.PlayerID).toBe(2);
    expect(result.Result.YouAre).not.toHaveProperty('PermanentTeammates');
  });
});
