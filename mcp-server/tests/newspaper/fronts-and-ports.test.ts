import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely, Selectable } from 'kysely';
import type { KnowledgeDatabase } from '../../src/knowledge/schema/base.js';
import type { CityInformation } from '../../src/knowledge/schema/timed.js';
import { newspaperEvidenceSchema } from '../../src/newspaper/evidence.js';
import { queryNewspaperEvidence } from '../../src/newspaper/queries.js';
import { createEvidenceDatabase, event, seedEvidence } from './fixtures.js';

let db: Kysely<KnowledgeDatabase>;
let baseCity: Selectable<CityInformation>;
const request = { receiverPlayerID: 0, previousCheckTurn: 9, cutoffTurn: 12 };

beforeEach(async () => {
  db = await createEvidenceDatabase();
  await seedEvidence(db);
  baseCity = await db.selectFrom('CityInformations').selectAll().executeTakeFirstOrThrow();
});
afterEach(async () => { await db.destroy(); });

/** Insert a dated city observation, defaulting to a copy of the seeded city. */
async function city(overrides: Partial<Selectable<CityInformation>>): Promise<void> {
  await db.insertInto('CityInformations').values({ ...baseCity, ...overrides } as any).execute();
}

/** Insert one recorded tactical zone with deterministic identity and dates. */
async function zone(id: number, turn: number, playerID: number, level: number, values: {
  zoneID: number; city?: string | null; domain?: string; posture?: string; units?: Record<string, Record<string, number>>;
}): Promise<void> {
  await db.insertInto('TacticalZones').values({
    ID: id, Turn: turn, CreatedAt: 5000 + id, Payload: {}, PlayerID: playerID,
    ZoneID: values.zoneID, Territory: 'None', Dominance: 'NoUnits',
    Domain: values.domain ?? 'Land', Posture: values.posture ?? 'None', AreaID: 1,
    City: values.city ?? null, CenterX: 0, CenterY: 0, Plots: 1, Value: 0,
    FriendlyStrength: 0, EnemyStrength: 0, NeutralStrength: 0, Neighbors: [], Units: values.units ?? {},
    Player0: level
  } as any).execute();
}

/** Read the projected event with one exact source row ID. */
async function eventWithID(id: number) {
  return (await queryNewspaperEvidence(db, request)).events.find(row => row.source.id === id)!;
}

/** Record a unit creation that the receiver can read. */
async function creation(id: number, playerID: number, unitID: number, unitType = 'Frigate', level = 1): Promise<void> {
  await event(db, id, 11, 'UnitCreated', { PlayerID: playerID, UnitID: unitID, UnitType: unitType }, level);
}

/** Record a training row with the given purchase flags and unit ID. */
async function training(id: number, playerID: number, cityID: number, unitID: number,
  payload: Record<string, unknown> = {}, level = 1): Promise<void> {
  await event(db, id, 11, 'CityTrained', { PlayerID: playerID, CityID: cityID, UnitID: unitID, ...payload }, level);
}

describe('newspaper tactical zones', () => {
  it('should keep the latest nonzero zone for the receiver at full visibility on the cutoff', async () => {
    await city({ ID: 22, Key: 5, Name: 'Stuttgart', X: 5 });
    await zone(601, 10, 0, 2, { zoneID: 5, city: 'Stuttgart', posture: 'Attrition',
      units: { Civ1: { Pikeman: 2 } } });
    await zone(602, 10, 0, 2, { zoneID: -3, domain: 'Sea', posture: 'Withdraw',
      units: { Civ1: { Frigate: 1 } } });
    await zone(603, 10, 0, 2, { zoneID: 5, city: 'Stuttgart', posture: 'Withdraw',
      units: { Civ0: { Rifleman: 1 } } });
    await zone(604, 10, 0, 2, { zoneID: 0, city: 'Ignored' });
    await zone(605, 10, 1, 2, { zoneID: 7, city: 'Foreign' });
    await zone(606, 9, 0, 2, { zoneID: 8, city: 'Earlier' });
    await zone(607, 10, 0, 1, { zoneID: 9, city: 'Basic' });
    await zone(608, 10, 0, 2, { zoneID: -1, city: null });
    await zone(609, 11, 0, 2, { zoneID: 10, city: 'Later' });

    const result = await queryNewspaperEvidence(db, { ...request, cutoffTurn: 10 });
    expect(newspaperEvidenceSchema.parse(result)).toEqual(result);
    expect(result.tacticalZones?.map(zone => zone.zoneID)).toEqual([-3, -1, 5]);
    expect(result.tacticalZones?.[0]).toEqual({
      source: { table: 'TacticalZones', id: 602, turn: 10, createdAt: 5602 },
      zoneID: -3, domain: 'Sea', posture: 'Withdraw', units: { Civ1: { Frigate: 1 } }
    });
    expect(result.tacticalZones?.[1]).not.toHaveProperty('city');
    expect(result.tacticalZones?.[2]).toEqual({
      source: { table: 'TacticalZones', id: 603, turn: 10, createdAt: 5603 },
      zoneID: 5, city: 'Stuttgart', domain: 'Land', posture: 'Withdraw', units: { Civ0: { Rifleman: 1 } }
    });
  });

  it('should hide city and civilization labels still unknown to the receiver', async () => {
    await city({ ID: 23, Key: 6, Owner: 'Civ2', Name: 'Unseen Harbor', Player0: 0 });
    await zone(610, 10, 0, 2, {
      zoneID: -6, city: 'Unseen Harbor', domain: 'Sea',
      units: { Civ2: { Frigate: 2 }, Civ1: { Trireme: 1 }, Barbarians: { Caravel: 1 } }
    });
    const result = await queryNewspaperEvidence(db, { ...request, cutoffTurn: 10 });
    const [front] = result.tacticalZones!;
    expect(front.city).toBeUndefined();
    expect(front.units).toEqual({ Civ1: { Trireme: 1 }, Barbarians: { Caravel: 1 } });
  });

  it('should compare only receiver sightings of the same readable city and zone', async () => {
    await city({ ID: 22, Turn: 9 });
    await city({ ID: 23, Key: 43, Name: 'Cape', X: 5, Turn: 9, Player0: 0 });
    await city({ ID: 24, Key: 43, Name: 'Cape', X: 5, Turn: 12 });
    await zone(610, 9, 0, 2, { zoneID: 42, city: 'Port', posture: 'Attrition' });
    await zone(611, 9, 1, 2, { zoneID: 42, city: 'Port', posture: 'Counterattack' });
    await zone(612, 10, 0, 2, { zoneID: -42, city: 'Port', domain: 'Sea', posture: 'Withdraw' });
    await zone(613, 9, 0, 2, { zoneID: 43, city: 'Cape', posture: 'Attrition' });
    await zone(614, 12, 0, 2, { zoneID: 42, city: 'Port', posture: 'Steamroll' });
    await zone(615, 12, 0, 2, { zoneID: -42, city: 'Port', domain: 'Sea', posture: 'Steamroll' });
    await zone(616, 12, 0, 2, { zoneID: 43, city: 'Cape', posture: 'Steamroll' });

    const { tacticalZones } = newspaperEvidenceSchema.parse(await queryNewspaperEvidence(db, request));
    const previous = (zoneID: number) => tacticalZones?.find(zone => zone.zoneID === zoneID)?.previousPosture;
    expect(previous(42)).toEqual({ posture: 'Attrition',
      source: { table: 'TacticalZones', id: 610, turn: 9, createdAt: 5610 } });
    expect(previous(-42)).toBeUndefined();
    expect(previous(43)).toBeUndefined();
  });

  it('keeps an empty front list and leaves fronts unknown without the table', async () => {
    expect((await queryNewspaperEvidence(db, request)).tacticalZones).toEqual([]);
    await db.schema.dropTable('TacticalZones').execute();
    const result = await queryNewspaperEvidence(db, request);
    expect(result.tacticalZones).toBeUndefined();
    expect(newspaperEvidenceSchema.parse(result)).toEqual(result);
  });
});

describe('newspaper port reports', () => {
  beforeEach(async () => {
    await city({ ID: 30, Key: 50, Turn: 10, CreatedAt: 3010, Owner: 'Civ0', Name: 'Rotterdam', X: 3, Y: 4, Player0: 2 });
  });

  it('reports an own produced launch with the dated port and the earlier creation', async () => {
    await creation(210, 0, 80);
    await training(211, 0, 50, 80, {
      WithGold: false, WithFaith: 0, Unit: { UnitType: 'Custom flagship' }, City: { City: 'Atlantis' }
    });

    const trained = await eventWithID(211);
    expect(trained.values).toEqual({
      PlayerID: 0, CityID: 50, UnitID: 80, WithGold: false, WithFaith: 0,
      CityX: 3, CityY: 4, Unit: 'Frigate', Port: 'Rotterdam'
    });
    expect(trained.relatedSources).toEqual([
      { table: 'CityInformations', id: 30, turn: 10, createdAt: 3010 },
      { table: 'GameEvents', id: 210, turn: 11, createdAt: 2011 }
    ]);
  });

  it('keeps generic training detail for a foreign launch without exposing a port', async () => {
    await creation(220, 1, 90);
    await training(221, 1, 42, 90, { WithGold: false, WithFaith: false });

    const trained = await eventWithID(221);
    expect(trained.values).toMatchObject({ Unit: 'Frigate', CityX: 0, CityY: 4 });
    expect(trained.values).not.toHaveProperty('Port');
  });

  it.each([
    ['missing both flags', {}],
    ['missing faith', { WithGold: false }],
    ['missing gold', { WithFaith: false }],
    ['null flags', { WithGold: null, WithFaith: null }],
    ['text flags', { WithGold: 'false', WithFaith: 'false' }]
  ])('withholds a port for %s', async (_label, flags) => {
    await creation(230, 0, 81);
    await training(231, 0, 50, 81, flags);
    expect((await eventWithID(231)).values).not.toHaveProperty('Port');
  });

  it.each([
    ['gold purchase', { WithGold: true, WithFaith: false }],
    ['faith purchase', { WithGold: false, WithFaith: true }],
    ['numeric gold purchase', { WithGold: 1, WithFaith: 0 }],
    ['numeric faith purchase', { WithGold: 0, WithFaith: 1 }]
  ])('withholds a port for a %s', async (_label, flags) => {
    await creation(240, 0, 82);
    await training(241, 0, 50, 82, flags);
    expect((await eventWithID(241)).values).not.toHaveProperty('Port');
  });

  it('withholds a port without a creation, after the training, with duplicates or from another owner', async () => {
    await training(250, 0, 50, 83, { WithGold: false, WithFaith: false });

    await training(251, 0, 50, 84, { WithGold: false, WithFaith: false });
    await creation(252, 0, 84);

    await creation(253, 0, 85);
    await creation(254, 0, 85);
    await training(255, 0, 50, 85, { WithGold: false, WithFaith: false });

    await creation(256, 1, 86);
    await training(257, 0, 50, 86, { WithGold: false, WithFaith: false });

    await creation(258, 0, 87, '   ');
    await training(259, 0, 50, 87, { WithGold: false, WithFaith: false });

    const events = (await queryNewspaperEvidence(db, request)).events;
    /** Read one training event by its exact source row. */
    const projected = (id: number) => events.find(row => row.source.id === id)!;
    for (const id of [250, 251, 255, 257, 259]) expect(projected(id).values).not.toHaveProperty('Port');
    // The generic rule still uses a unique creation from the same turn even when it was recorded later.
    expect(projected(251).values).toHaveProperty('Unit', 'Frigate');
    expect(projected(255).values).not.toHaveProperty('Unit');
    expect(projected(257).values).not.toHaveProperty('Unit');
    expect(projected(259).values).not.toHaveProperty('Unit');
  });

  it('does not fall back to a city observation recorded after the training', async () => {
    await db.deleteFrom('CityInformations').where('Key', '=', 50).execute();
    await city({ ID: 31, Key: 50, Turn: 12, CreatedAt: 3012, Owner: 'Civ0', Name: 'Rotterdam', X: 3, Y: 4, Player0: 2 });
    await creation(258, 0, 87);
    await training(259, 0, 50, 87, { WithGold: false, WithFaith: false });

    const trained = await eventWithID(259);
    expect(trained.values).not.toHaveProperty('Port');
    expect(trained.values).not.toHaveProperty('CityX');
    expect(trained.values).not.toHaveProperty('CityY');
  });
});
