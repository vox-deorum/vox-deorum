import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as playerInformation from '../../../src/knowledge/getters/player-information.js';
import * as playerOpinions from '../../../src/knowledge/getters/player-opinions.js';
import * as playerSummary from '../../../src/knowledge/getters/player-summary.js';
import createGetOpinionsTool from '../../../src/tools/knowledge/get-opinions.js';
import { connectToolClient } from '../tool-client.js';

const tool = createGetOpinionsTool();
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  vi.spyOn(playerInformation, 'getPlayerInformations').mockResolvedValue([
    { Key: 0, TeamID: 0, Civilization: 'Rome', Leader: 'Augustus', IsMajor: 1 } as any,
    { Key: 1, TeamID: 1, Civilization: 'Egypt', Leader: 'Ramesses', IsMajor: 1 } as any,
    { Key: 2, TeamID: 2, Civilization: 'Geneva', Leader: 'City State', IsMajor: 0 } as any,
    { Key: 3, TeamID: 3, Civilization: 'Greece', Leader: 'Alexander', IsMajor: 1 } as any,
  ]);
  vi.spyOn(playerSummary, 'getPlayerSummaries').mockResolvedValue([
    { Key: 0, Player0: 2, Player1: 2 },
    { Key: 1, Player0: 1, Player1: 2 },
    { Key: 2, Player0: 1, Player1: 1 },
    { Key: 3, Player0: 0, Player1: 0 },
  ] as any);
  const romeViewOpinions = {
    OpinionFrom0: 'Planning is steady',
    OpinionTo0: 'Evaluation is cautious',
    OpinionFrom1: 'Delegation is open',
    OpinionTo1: 'Agreement is strong',
    OpinionFrom2: 'A city-state view',
    OpinionTo2: 'A city-state response',
    OpinionFrom3: 'Leaders are careful',
    OpinionTo3: 'Envoys are welcome',
  };
  const egyptViewOpinions = {
    OpinionFrom0: 'Rome gives an independent assessment',
    OpinionTo0: 'Egypt evaluates Rome with care',
    OpinionFrom1: 'Egypt maintains a distinct position',
    OpinionTo1: 'Leaders are aligned',
  };
  vi.spyOn(playerOpinions, 'getPlayerOpinions').mockImplementation(async playerID => {
    if (playerID === 0) return romeViewOpinions as any;
    if (playerID === 1) return egyptViewOpinions as any;
    throw new Error('The opinion fixture only contains players 0 and 1');
  });
  client = await connectToolClient(tool);
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
});

describe('get-opinions', () => {
  it('returns bidirectional opinions for met majors and reveals an unmet major on request', async () => {
    const defaultView = await client.call({ PlayerID: 0 });
    expect(defaultView['1']).toMatchObject({
      Civilization: 'Egypt',
      OurOpinionOfThem: ['Agreement is strong'],
      TheirOpinionOfUs: ['Delegation is open'],
    });
    expect(defaultView['2']).toBeUndefined();
    expect(defaultView['3']).toEqual(expect.any(String));
    expect(defaultView['3']).not.toHaveProperty('Civilization');
    expect(defaultView['3']).not.toHaveProperty('OurOpinionOfThem');
    expect(defaultView['3']).not.toHaveProperty('TheirOpinionOfUs');

    const revealed = await client.call({ PlayerID: 0, RevealAll: true });
    expect(revealed['3']).toMatchObject({
      Civilization: 'Greece',
      OurOpinionOfThem: ['Envoys are welcome'],
      TheirOpinionOfUs: ['Leaders are careful'],
    });

    const egyptView = await client.call({ PlayerID: 1 });
    expect(egyptView['0']).toMatchObject({
      Civilization: 'Rome',
      OurOpinionOfThem: ['Egypt evaluates Rome with care'],
      TheirOpinionOfUs: ['Rome gives an independent assessment'],
    });
  });
});
