/**
 * Settings and metadata tests with a real in-memory KnowledgeStore and stubbed Lua calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as z from 'zod';

import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { getPlayerInformations } from '../../../src/knowledge/getters/player-information.js';
import { MCPServer } from '../../../src/server.js';
import { getTool } from '../../../src/tools/index.js';
import { setupStore, seedPlayer } from '../helpers.js';
import createGetGameSettingsTool from '../../../src/tools/knowledge/get-game-settings.js';
import createGetMetadataTool from '../../../src/tools/knowledge/get-metadata.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

let store: KnowledgeStore;
let tool: ReturnType<typeof createGetGameSettingsTool>;
let client: Awaited<ReturnType<typeof connectToolClient>>;

/** Build a tool whose Lua call returns fixed static settings. */
function createTool() {
  const tool = createGetGameSettingsTool();
  vi.spyOn(tool as any, 'call').mockImplementation(async (playerID: unknown) => ({ Success: true, Result: {
    GameSpeed: 'Standard', MapType: 'Assets\\Maps\\Continents.lua', MapSize: 'Small',
    YouAre: typeof playerID === 'number' && playerID >= 0 ? { Name: ['Rome', 'Greece', 'Egypt'][playerID] ?? 'Custom', Leader: 'Custom Leader', PlayerID: playerID, Type: `CIV_${['Rome', 'Greece', 'Egypt'][playerID]}` } : undefined,
    GameSpeedMultiplier: 1.5,
    Difficulty: 'Prince', StartEra: 'Ancient', MaxTurns: 500, VictoryTypes: ['Domination'],
  } }));
  return tool;
}

beforeEach(async () => {
  vi.spyOn(getTool('getCivilization')!, 'getSummaries').mockResolvedValue(['Rome', 'Greece', 'Egypt', 'Venice'].map(Name => ({ Name, Type: `CIV_${Name}`, Leader: `${Name} Leader`, Uniques: [`${Name} Unique`] })));
  store = await setupStore(10);
  vi.spyOn(MCPServer.getInstance().getBridgeManager(), 'executeLuaScript').mockResolvedValue({ success: false });
  await seedPlayer(store, 0, { civilization: 'Rome', leader: 'Augustus Caesar', teamID: 0 });
  await seedPlayer(store, 1, { civilization: 'Greece', leader: 'Alexander', teamID: 0 });
  await seedPlayer(store, 2, { civilization: 'Egypt', leader: 'Ramesses II', teamID: 2 });
  await seedPlayer(store, 3, { civilization: 'Venice', leader: 'Enrico Dandolo', teamID: 0, isMajor: 0 });
  tool = createTool();
  client = await connectToolClient(tool, createGetMetadataTool());
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
  await store.close();
});

it('records geometry for internal use and leaves only public map settings in the tools', async () => {
  const executeLuaScript = vi.mocked(MCPServer.getInstance().getBridgeManager().executeLuaScript);
  executeLuaScript.mockResolvedValue({ success: true, result: {
    mapWidth: 80, mapHeight: 52, mapWrapX: true, mapWrapY: false
  } });
  const luaResponse = await (tool as any).call(-1);
  Object.assign(luaResponse.Result, { MapWidth: 80, MapHeight: 52, MapWrapX: true, MapWrapY: false });
  vi.mocked((tool as any).call).mockResolvedValue(luaResponse);

  const { Result } = await client.call({});
  const publicSchema = z.toJSONSchema(tool.outputSchema);
  expect(Result).toMatchObject({ MapType: 'Continents', MapSize: 'Small' });
  for (const field of ['MapWidth', 'MapHeight', 'MapWrapX', 'MapWrapY']) {
    expect(Result).not.toHaveProperty(field);
    expect(JSON.stringify(publicSchema)).not.toContain(field);
  }
  for (const [key, value] of Object.entries({ mapWidth: '80', mapHeight: '52', mapWrapX: 'true', mapWrapY: 'false' })) {
    expect(await store.getMetadata(key)).toBe(value);
    expect(await client.call({ Key: key }, 'get-metadata')).toBe('');
  }
  expect(await client.call({ Key: 'mapSize' }, 'get-metadata')).toBe('Small');
  await client.call({});
  expect(executeLuaScript).toHaveBeenCalledTimes(1);
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
  it.each([['\uc6b0\ub9ac \ubb38\uba85', '\uc0ac\uc6a9\uc790'], ['\u81ea\u5b9a\u4e49\u6587\u660e', '\u73a9\u5bb6']])('keeps custom display identity %s and enriches by stable civilization type', async (name, leader) => {
    vi.mocked((tool as any).call).mockResolvedValue({ Success: true, Result: {
      GameSpeed: '\ud45c\uc900', GameSpeedMultiplier: 1, MapType: 'Continents.lua', MapSize: 'Small', Difficulty: 'Prince',
      StartEra: 'Ancient', MaxTurns: 500, VictoryTypes: [],
      YouAre: { Name: name, Leader: leader, PlayerID: 0, Type: 'CIV_Rome' },
    } });
    const { Result } = await client.call({ PlayerID: 0 });
    expect(Result.YouAre).toMatchObject({ Name: name, Leader: leader, PlayerID: 0, Uniques: ['Rome Unique'] });
    expect(Result.YouAre).not.toHaveProperty('Type');
  });

  it('preserves basic identity when catalog enrichment throws or no teammate row exists', async () => {
    vi.mocked(getTool('getCivilization')!.getSummaries).mockRejectedValueOnce(new Error('catalog unavailable'));
    const { Result } = await client.call({ PlayerID: 9 });
    expect(Result.YouAre).toMatchObject({ Name: 'Custom', Leader: 'Custom Leader', PlayerID: 9 });
  });


  it('recovers permanent teammates when initial player collection left an empty cache', async () => {
    await store.getDatabase().deleteFrom('PlayerInformations').execute();
    const execute = vi.spyOn(LuaFunction.prototype, 'execute')
      .mockResolvedValueOnce({ success: false, error: { code: 'UNAVAILABLE', message: 'Startup collection unavailable' } })
      .mockResolvedValueOnce({ success: true, result: [
        { Key: 0, Civilization: 'Rome', Leader: 'Cached Leader', TeamID: 4, IsMajor: 1, IsHuman: 0 },
        { Key: 1, Civilization: 'Greece', Leader: 'Alexander', TeamID: 4, IsMajor: 1, IsHuman: 0 },
      ] });
    expect(await getPlayerInformations()).toEqual([]);

    const { Result } = await client.call({ PlayerID: 0 });
    expect(Result.YouAre).toMatchObject({ Name: 'Rome', Leader: 'Custom Leader', PlayerID: 0 });
    expect(Result.YouAre.PermanentTeammates).toEqual(['Player 1: Greece (Alexander)']);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(await store.getAllPublicKnowledge('PlayerInformations')).toHaveLength(2);
  });

  it('preserves live identity when optional player collection fails', async () => {
    await store.getDatabase().deleteFrom('PlayerInformations').execute();
    vi.spyOn(LuaFunction.prototype, 'execute').mockRejectedValue(new Error('Player collection unavailable'));

    const result = await client.call({ PlayerID: 0 });
    expect(result.Success).toBe(true);
    expect(result.Result.YouAre).toMatchObject({ Name: 'Rome', Leader: 'Custom Leader', PlayerID: 0 });
    expect(result.Result.YouAre).not.toHaveProperty('PermanentTeammates');
  });

  it.each([{}, { PlayerID: -1 }])('returns general settings for %j', async args => {
    const result = await client.call(args);
    expect(result.Success).toBe(true);
    expect(result.Result).not.toHaveProperty('YouAre');
    expect(result.Result.GameSpeedMultiplier).toBe(1.5);
  });

  it('returns failed Lua results unchanged before reading metadata', async () => {
    vi.mocked((tool as any).call).mockResolvedValue({ Success: false, Error: { Code: 'UNAVAILABLE', Message: 'Unavailable' } });
    expect(await client.call({ PlayerID: 0 })).toMatchObject({ Success: false, Error: { Code: 'UNAVAILABLE' } });
    expect(await store.getMetadata('gameSpeed')).toBeUndefined();
  });

  it.each([undefined, { Name: 'Rome', Leader: 'Augustus', PlayerID: 1 }])('rejects missing or mismatched identity before caching', async identity => {
    const response = await (tool as any).call(0);
    response.Result.YouAre = identity;
    vi.mocked((tool as any).call).mockResolvedValue(response);
    expect(await client.call({ PlayerID: 0 })).toMatchObject({ Success: false, Error: { Code: 'IDENTITY_UNAVAILABLE' } });
    expect(await store.getMetadata('gameSpeed')).toBeUndefined();
  });

});
