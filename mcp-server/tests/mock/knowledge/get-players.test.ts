import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupStore, seedPlayer } from '../helpers.js';
import * as playerSummary from '../../../src/knowledge/getters/player-summary.js';
import { connectToolClient } from '../tool-client.js';
import createGetPlayersTool from '../../../src/tools/knowledge/get-players.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createGetPlayersTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupStore(12);
  await seedPlayer(store, 0, { civilization: 'Rome', leader: 'Augustus', teamID: 0 });
  await seedPlayer(store, 1, { civilization: 'Egypt', leader: 'Ramesses', teamID: 1 });
  await seedPlayer(store, 2, { civilization: 'Greece', leader: 'Alexander', teamID: 2 });
  vi.spyOn(playerSummary, 'getPlayerSummaries').mockResolvedValue([
    { Key: 0, Player0: 2, Score: 180, Era: 'Classical', Gold: 120, GoldPerTurn: 8, MilitaryUnits: 5, MilitaryStrength: 44 } as any,
    { Key: 1, Player0: 2, Score: 145, Era: 'Medieval', Gold: 75, GoldPerTurn: 4, MilitaryUnits: 3, MilitaryStrength: 29 } as any,
    { Key: 2, Player0: 0, Player1: 2, Score: 132, Era: 'Ancient' } as any,
  ]);
  await store.storeMutableKnowledge('PlayerOpinions', 0, {
    OpinionFrom1: 'Egypt respects us',
    OpinionTo1: 'We trust Egypt',
  } as any);
  await store.storeMutableKnowledge('PlayerOpinions', 1, {
    OpinionFrom0: 'Rome provides a clear signal',
    OpinionTo0: 'Egypt considers Rome carefully',
    OpinionFrom2: 'Greece keeps its distance',
    OpinionTo2: 'Egypt respects Greece',
  } as any);
  client = await connectToolClient(tool);
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
  await store.close();
});

describe('get-players', () => {
  it('returns civilization names and documented summary fields for each player', async () => {
    const result = await client.call({ PlayerID: 0 });

    expect(result['0']).toMatchObject({ Civilization: 'Rome', Leader: 'Augustus', Era: 'Classical', Score: 180 });
    expect(result['1']).toMatchObject({
      Civilization: 'Egypt',
      Leader: 'Ramesses',
      Era: 'Medieval',
      Score: 145,
      Gold: 75,
      GoldPerTurn: 4,
      MilitaryUnits: 3,
      MilitaryStrength: 29,
    });
    expect(result['2']).toEqual(expect.any(String));
    expect(result['2']).not.toHaveProperty('Civilization');

    const egyptView = await client.call({ PlayerID: 1 });
    expect(egyptView['2']).toMatchObject({ Civilization: 'Greece', Leader: 'Alexander', Era: 'Ancient', Score: 132 });
  });
});
