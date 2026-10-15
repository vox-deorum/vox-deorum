import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupStore, seedPlayer } from '../helpers.js';
import * as victoryProgress from '../../../src/knowledge/getters/victory-progress.js';
import * as playerSummary from '../../../src/knowledge/getters/player-summary.js';
import createGetVictoryProgressTool from '../../../src/tools/knowledge/get-victory-progress.js';
import { connectToolClient } from '../tool-client.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createGetVictoryProgressTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupStore(14);
  await seedPlayer(store, 0, { civilization: 'Rome', leader: 'Augustus', teamID: 0 });
  await seedPlayer(store, 1, { civilization: 'Egypt', leader: 'Ramesses', teamID: 1 });
  await seedPlayer(store, 2, { civilization: 'Greece', leader: 'Alexander', teamID: 2 });
  vi.spyOn(playerSummary, 'getPlayerSummaries').mockResolvedValue([
    { Key: 0, Player0: 2, Player1: 1 },
    { Key: 1, Player0: 1, Player1: 2 },
    { Key: 2, Player0: 0, Player1: 1 },
  ] as any);
  vi.spyOn(victoryProgress, 'getVictoryProgress').mockImplementation(async () => ({
    DominationVictory: {
      Rome: { CapitalsNeeded: 2, Contender: 'Egypt' },
      Egypt: { CapitalsNeeded: 1, Contender: 'Rome' },
      Greece: { CapitalsNeeded: 3, Contender: null },
    },
    ScienceVictory: 'Not available',
    CulturalVictory: 'Not available',
    DiplomaticVictory: 'Not available',
  } as any));
  client = await connectToolClient(tool);
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
  await store.close();
});

describe('get-victory-progress', () => {
  it('returns only victory progress visible from each requested player perspective', async () => {
    const romeView = await client.call({ PlayerID: 0 });
    expect(romeView.DominationVictory).toMatchObject({
      Rome: { CapitalsNeeded: 2 },
      Egypt: { CapitalsNeeded: 1 },
    });
    expect(romeView.DominationVictory).not.toHaveProperty('Greece');

    const egyptView = await client.call({ PlayerID: 1 });
    expect(egyptView.DominationVictory).toMatchObject({
      Rome: { CapitalsNeeded: 2 },
      Egypt: { CapitalsNeeded: 1 },
      Greece: { CapitalsNeeded: 3 },
    });
  });
});
