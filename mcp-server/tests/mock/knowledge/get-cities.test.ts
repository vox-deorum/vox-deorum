import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cityInformation from '../../../src/knowledge/getters/city-information.js';
import createGetCitiesTool from '../../../src/tools/knowledge/get-cities.js';
import { connectToolClient } from '../tool-client.js';

const tool = createGetCitiesTool();
let client: Awaited<ReturnType<typeof connectToolClient>>;

/** Build a city fixture with distinct owner, detail values, and viewer visibility. */
function city(key: number, name: string, owner: string, visibility: [number, number, number]) {
  return {
    Key: key,
    Name: name,
    Owner: owner,
    X: key,
    Y: key + 1,
    Population: 5 + key,
    MajorityReligion: null,
    DefenseStrength: 20 + key,
    HitPoints: 100,
    MaxHitPoints: 100,
    IsCapital: 0,
    IsPuppet: 0,
    IsOccupied: 0,
    IsCoastal: 1,
    FoodStored: 8 + key,
    FoodPerTurn: 2,
    ProductionStored: 9,
    ProductionPerTurn: 3,
    GoldPerTurn: 4,
    SciencePerTurn: 5,
    CulturePerTurn: 6,
    FaithPerTurn: 1,
    TourismPerTurn: 0,
    HappinessDelta: 1,
    RazingTurns: 0,
    ResistanceTurns: 0,
    BuildingCount: 3,
    Wonders: [],
    ImportantBuildings: ['Library'],
    GreatWorkCount: 0,
    CurrentProduction: 'Granary',
    ProductionTurnsLeft: 2,
    Player0: visibility[0],
    Player1: visibility[1],
    Player2: visibility[2],
  };
}

describe('get-cities', () => {
  it('preserves health strings, basic wonders, display conversions and the unpopulated capital field', async () => {
    vi.mocked(cityInformation.getCityInformations).mockResolvedValue([
      { ...city(12, 'Rome', 'LeaderA', [1, 2, 0]), HitPoints: 45, IsCapital: 1, Wonders: ['Beacon'] }
    ] as any);
    const basic = (await client.call({ PlayerID: 0 })).LeaderA.Rome;
    expect(basic).toMatchObject({ Health: '45%', Wonders: ['Beacon'], IsCoastal: true });
    for (const key of ['IsCapital', 'IsPuppet', 'IsOccupied', 'RazingTurns', 'ResistanceTurns', 'FoodStored']) expect(basic).not.toHaveProperty(key);
    const full = (await client.call({ PlayerID: 1 })).LeaderA.Rome;
    expect(full).toHaveProperty('FoodStored', 20);
    expect(full).not.toHaveProperty('IsCapital');
  });

  beforeEach(async () => {
    vi.spyOn(cityInformation, 'getCityInformations').mockResolvedValue([
      city(12, 'Rome', 'LeaderA', [0, 1, 2]),
      city(20, 'Alexandria', 'LeaderB', [1, 2, 0]),
    ] as any);
    client = await connectToolClient(tool);
  });

  afterEach(async () => {
    await client.close();
    vi.restoreAllMocks();
  });

  it('filters cities by viewer visibility and Owner while returning basic or detailed fields', async () => {
    const hidden = await client.call({ PlayerID: 0 });
    expect(hidden).not.toHaveProperty('LeaderA');
    expect(hidden.LeaderB.Alexandria).toMatchObject({ ID: 20, Population: 25 });
    expect(hidden.LeaderB.Alexandria).not.toHaveProperty('FoodStored');

    const basic = await client.call({ PlayerID: 1 });
    expect(basic.LeaderA.Rome).toMatchObject({ ID: 12, Population: 17 });
    expect(basic.LeaderA.Rome).not.toHaveProperty('CurrentProduction');
    expect(basic.LeaderB.Alexandria).toHaveProperty('FoodStored', 28);

    const detailed = await client.call({ PlayerID: 2 });
    expect(detailed.LeaderA.Rome).toMatchObject({ FoodStored: 20, CurrentProduction: 'Granary' });
    expect(detailed).not.toHaveProperty('LeaderB');

    const ownerFiltered = await client.call({ PlayerID: 1, Owner: 'LeaderA' });
    expect(Object.keys(ownerFiltered)).toEqual(['LeaderA']);
    expect(ownerFiltered.LeaderA).toHaveProperty('Rome');
    expect(ownerFiltered.LeaderA).not.toHaveProperty('Alexandria');

    const ownerCannotRevealHidden = await client.call({ PlayerID: 0, Owner: 'LeaderA' });
    expect(ownerCannotRevealHidden).toEqual({});
  });

  it('keeps HappinessDelta and omits recorded unhappiness causes for full detail and unscoped reads', async () => {
    vi.mocked(cityInformation.getCityInformations).mockResolvedValue([
      {
        ...city(30, 'Carthage', 'LeaderC', [2, 2, 0]),
        HappinessDelta: -4,
        UnhappinessSources: { Culture: 3, Religion: 1 }
      }
    ] as any);

    // A level-2 receiver gets the existing net happiness value without the cause breakdown.
    const full = (await client.call({ PlayerID: 0 })).LeaderC.Carthage;
    expect(full.HappinessDelta).toBe(-4);
    expect(full).not.toHaveProperty('UnhappinessSources');

    // The unscoped response reads at full detail too, and follows the same rule.
    const unscoped = (await client.call({})).LeaderC.Carthage;
    expect(unscoped.HappinessDelta).toBe(-4);
    expect(unscoped).not.toHaveProperty('UnhappinessSources');
  });
});
