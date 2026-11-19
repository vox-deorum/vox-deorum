import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../../src/knowledge/schema/base.js';
import { queryNewspaperEvidence } from '../../src/newspaper/queries.js';
import { newspaperEvidenceRequestSchema, newspaperEvidenceSchema } from '../../src/newspaper/evidence.js';
import { readEvents, readSnapshotRange, readSnapshotsAtCutoff } from '../../src/knowledge/history.js';
import { createEvidenceDatabase, seedEvidence, summary, event } from './fixtures.js';

const request = { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10, comparisonRange: { fromTurn: 5, toTurn: 10 } };
let db: Kysely<KnowledgeDatabase>;
beforeEach(async () => { db = await createEvidenceDatabase(); await seedEvidence(db); });
afterEach(async () => { await db.destroy(); });

describe('historical evidence queries', () => {
  it('should publish a met civilization’s named birth and use only visible events as stories about its deaths', async () => {
    const unit = { GreatPerson: 'Hypatia' };
    // An unrelated unit with the same local ID can extend the common event visibility.
    const unwitnessed = { GreatPerson: 'Hypatia', GreatPersonVisibility: [0, 2] };
    await event(db, 201, 8, 'UnitCreated', { PlayerID: 1, UnitID: 11, Unit: unwitnessed, PlotX: 2, PlotY: 3 });
    await event(db, 202, 8, 'GreatPersonExpended', { PlayerID: 1, UnitID: 11, Unit: unit, CityX: 2, CityY: 3 }, 0);
    await event(db, 203, 8, 'UnitPrekill', { OwnerID: 1, UnitID: 11, Unit: unit, DelayKill: false });
    await event(db, 204, 9, 'UnitPrekill', { OwnerID: 1, UnitID: 12,
      Unit: { GreatPerson: 'Homer', GreatPersonVisibility: [0, 2] }, DelayKill: false });
    await event(db, 205, 9, 'UnitPrekill', { OwnerID: 1, UnitID: 13,
      Unit: { GreatPerson: 'Euclid', GreatPersonVisibility: [2, 2] }, DelayKill: false });

    const result = await queryNewspaperEvidence(db, { ...request, historyFromTurn: 5 });
    const lifeEvents = result.events.filter(row => row.source.id >= 201);
    expect(lifeEvents.map(row => row.source.id)).toEqual([201, 205]);
    expect(lifeEvents[0].values).toEqual({ PlayerID: 1, Person: 'Hypatia' });
    expect(lifeEvents[1].values).toMatchObject({ OwnerID: 1, Person: 'Euclid' });
    expect(result.history?.events.filter(row => row.source.id >= 201)).toEqual(lifeEvents);
  });

  it('should leave a gifted great person out of birth and death news', async () => {
    await event(db, 201, 8, 'UnitCreated', {
      PlayerID: 0, UnitID: 12, UnitType: 'Great Scientist', Unit: { GreatPerson: 'Temporary Name' },
    });
    await event(db, 202, 8, 'UnitCreated', { PlayerID: 1, UnitID: 11, Unit: { GreatPerson: 'Other Name' } }, 0);
    await event(db, 203, 8, 'UnitConverted', { OldOwnerID: 1, OriginalUnitID: 12, NewOwnerID: 0, ConvertingUnitID: 12 }, 0);
    await event(db, 204, 8, 'UnitConverted', { OldOwnerID: 0, OriginalUnitID: 11, NewOwnerID: 1, ConvertingUnitID: 11 }, 0);
    await event(db, 205, 8, 'UnitPrekill', { OwnerID: 1, UnitID: 12, DelayKill: false, Unit: { GreatPerson: 'Hypatia' } });
    await event(db, 206, 8, 'UnitCreated', { PlayerID: 1, UnitID: 12, Unit: { GreatPerson: 'Euclid' } }, 0);

    const lifeEvents = (await queryNewspaperEvidence(db, request)).events.filter(row => row.source.id >= 201);
    expect(lifeEvents.map(row => row.source.id)).toEqual([201, 206]);
    expect(lifeEvents[0].values).toMatchObject({ Unit: 'Great Scientist' });
    expect(lifeEvents[0].values).not.toHaveProperty('Person');
    expect(lifeEvents[1].values).toEqual({ PlayerID: 1, Person: 'Euclid' });
  });

  it('should use the turn index for event windows and lifecycle reads and support recordings without it', async () => {
    const window = await sql<{ detail: string }>`explain query plan select * from GameEvents
      where Turn >= ${6} and Turn <= ${10} and Player0 >= ${1} order by ID`.execute(db);
    const lifecycle = await sql<{ detail: string }>`explain query plan select * from GameEvents
      where Type in ('CityRazed', 'CityCaptureComplete') and Turn <= ${10} and Player0 >= ${1}`.execute(db);
    for (const plan of [window, lifecycle]) {
      expect(plan.rows.some(row => row.detail.includes('SEARCH GameEvents USING INDEX idx_gameevents_turn'))).toBe(true);
    }
    const before = await queryNewspaperEvidence(db, request);
    await db.schema.dropIndex('idx_gameevents_turn').execute();
    expect(await queryNewspaperEvidence(db, request)).toEqual(before);
  });

  it('should return identical evidence with a large superseded history before the required window', async () => {
    // The pre-window diplomacy baseline is required evidence too.
    for (const key of [0, 1, 2]) await summary(db, 3000 + key, key, 4, 2);
    const before = await queryNewspaperEvidence(db, request);
    for (let index = 0; index < 1500; index++) {
      await summary(db, 1000 + index, index % 3, Math.floor(index / 300), 2, {
        Gold: index, PolicyBranches: { Tradition: ['A'] }, DiplomatPoints: { Player1: 800, Player2: 800 }
      });
    }
    expect(await queryNewspaperEvidence(db, request)).toEqual(before);
  });

  it('should keep the original diplomat gate for national facts older than the window', async () => {
    await db.deleteFrom('PlayerSummaries').where('Key', '=', 1).execute();
    await summary(db, 100, 0, 2, 2, { DiplomatPoints: {} });
    await summary(db, 101, 1, 2, 1, { CulturePerTurn: 4, PolicyBranches: { Tradition: ['A'] } });
    const result = await queryNewspaperEvidence(db, request);
    const stale = result.players.find(row => row.subjectID === 1)!;
    expect(stale.source.turn).toBe(2);
    expect(stale.values.CulturePerTurn).toBe(4);
    expect(stale.values.PolicyBranches).toEqual({ Tradition: 1 });
  });

  it('should retire a razed city using coordinates even when its event precedes the requested event window', async () => {
    await event(db, 110, 11, 'CityRazed', { PlayerID: 1, CityX: 0, CityY: 4 });
    expect((await queryNewspaperEvidence(db, request)).cities.map(row => row.subjectID)).toEqual([42]);
    const later = await queryNewspaperEvidence(db, { ...request, previousCheckTurn: 11, cutoffTurn: 12 });
    expect(later.cities).toEqual([]);
    expect(later.comparisons.cities.map(row => row.subjectID)).toEqual([42]);
    expect(later.events).toEqual([]);
  });

  it('should retire the old capture Key and retain its replacement and later observations', async () => {
    const city = await db.selectFrom('CityInformations').selectAll().executeTakeFirstOrThrow();
    await event(db, 110, 11, 'CityCaptureComplete', {
      OldOwnerID: 1, NewOwnerID: 0, CityX: 0, CityY: 4, IsCapital: false,
      Population: 1, IsConquest: true, TotalGreatWorks: 0, CapturedGreatWorks: 0,
      OldOwner: { Name: 'Leader1', Civilization: 'Civ1' }, NewOwner: { Name: 'Leader0', Civilization: 'Civ0' },
      City: { Owner: 'Civ0', City: 'Port', CityID: 43, Population: 1 }
    });
    await db.insertInto('CityInformations').values({ ...city, ID: 22, Key: 43, Turn: 11, CreatedAt: 2012, Owner: 'Civ0' } as any).execute();
    expect((await queryNewspaperEvidence(db, { ...request, cutoffTurn: 11 })).cities.map(row => row.subjectID)).toEqual([43]);
    await db.insertInto('CityInformations').values({ ...city, ID: 23, Turn: 12, CreatedAt: 2013 } as any).execute();
    expect((await queryNewspaperEvidence(db, { ...request, cutoffTurn: 12 })).cities.map(row => row.subjectID)).toEqual([42, 43]);
  });

  it('should respect same-turn timestamps and flag ties or missing coordinates without guessing', async () => {
    await event(db, 110, 10, 'CityRazed', { PlayerID: 1, CityX: 0, CityY: 4 });
    await db.updateTable('GameEvents').set({ CreatedAt: 3010 }).where('ID', '=', 110).execute();
    const tied = await queryNewspaperEvidence(db, request);
    expect(tied.cities).toHaveLength(1);
    expect(tied.limitations).toEqual(['cityLifecycleOrderUnknown']);
    await db.updateTable('GameEvents').set({ CreatedAt: 3009 }).where('ID', '=', 110).execute();
    expect((await queryNewspaperEvidence(db, request)).cities).toHaveLength(1);
    await db.updateTable('GameEvents').set({ CreatedAt: 3011 }).where('ID', '=', 110).execute();
    expect((await queryNewspaperEvidence(db, request)).cities).toEqual([]);
    await db.deleteFrom('GameEvents').where('ID', '=', 110).execute();
    await event(db, 111, 10, 'CityRazed', { PlayerID: 1 });
    expect((await queryNewspaperEvidence(db, request)).limitations).toEqual(['cityLifecycleUnresolved']);
  });

  it('should keep cities at other coordinates and avoid using invisible or future removals', async () => {
    await event(db, 110, 11, 'CityRazed', { PlayerID: 1, CityX: 0, CityY: 5 });
    await event(db, 111, 11, 'CityRazed', { PlayerID: 1, CityX: 0, CityY: 4 }, 0);
    await event(db, 112, 13, 'CityRazed', { PlayerID: 1, CityX: 0, CityY: 4 });
    expect((await queryNewspaperEvidence(db, { ...request, cutoffTurn: 12 })).cities).toHaveLength(1);
  });

  it('should select by cutoff and insertion ID rather than IsLatest or Version', async () => {
    await db.updateTable('PlayerSummaries').set({ Version: 999 }).where('ID', '=', 4).execute();
    const result = await queryNewspaperEvidence(db, request);
    expect(result.players.find(row => row.subjectID === 0)).toMatchObject({
      source: { table: 'PlayerSummaries', id: 5, turn: 10, createdAt: 1010 }, values: { Gold: 20, Era: 'Classical' }
    });
    expect(result.comparisons.players.filter(row => row.subjectID === 0).map(row => row.source.id)).toEqual([1, 5]);
    expect(newspaperEvidenceSchema.parse(result)).toEqual(result);
  });

  it('should order cutoff by turn even when an earlier turn was inserted later', async () => {
    await summary(db, 100, 0, 7, 2, { Gold: 7 });
    const rows = await readSnapshotsAtCutoff(db, 'PlayerSummaries', 10);
    expect(rows.find(row => row.Key === 0)?.ID).toBe(5);
    const range = await readSnapshotRange(db, 'PlayerSummaries', 7, 10);
    expect(range.map(row => row.ID)).toEqual([100, 5, 6]);
  });

  it('should apply city cutoff and same-turn ties before visibility, without falling back to a visible older row', async () => {
    const city = await db.selectFrom('CityInformations').selectAll().executeTakeFirstOrThrow();
    await db.insertInto('CityInformations').values([
      { ...city, ID: 22, Turn: 10, Version: 0, Population: 1 },
      { ...city, ID: 23, Turn: 20, Population: 2 },
      { ...city, ID: 24, Turn: 7, Population: 3 }
    ] as any).execute();
    const result = await queryNewspaperEvidence(db, request);
    expect(result.cities[0]).toMatchObject({ source: { id: 22, turn: 10 }, values: { Population: 1 } });
    expect(result.comparisons.cities.map(row => row.source.id)).toEqual([24, 22]);
    await db.insertInto('CityInformations').values({ ...city, ID: 25, Turn: 10, Player0: 0 } as any).execute();
    expect((await queryNewspaperEvidence(db, request)).cities).toEqual([]);
    await summary(db, 8, 1, 10, 0, { CulturePerTurn: 50 });
    expect((await queryNewspaperEvidence(db, request)).players.map(row => row.subjectID)).toEqual([0]);
  });

  it('should bound events after previous check through cutoff and keep raw false and zero', async () => {
    const result = await queryNewspaperEvidence(db, request);
    expect(result.events.map(row => row.source.id)).toEqual([102, 103, 106]);
    expect(result.events[0].values.IsAggressor).toBe(false);
    expect(result.events[1].values).toEqual({ TeamID: 0, HasTech: false });
    expect(result.events[1].source.createdAt).toBe(2010);
    expect(result.events[2].values).toEqual({ PlayerID: 0, HolyCityID: 42 });
    expect((await queryNewspaperEvidence(db, { ...request, previousCheckTurn: 10 })).events).toEqual([]);
  });

  it('should share exact-turn, type, ID bounds, visibility and ID ordering with live event reads', async () => {
    expect((await readEvents(db, { Turn: 10, Type: 'TeamSetHasTech', After: 102, Before: 103, PlayerID: 0 })).map(row => row.ID)).toEqual([103]);
    expect((await readEvents(db, { FromTurn: 9, ToTurn: 10, PlayerID: 0 })).map(row => row.ID)).toEqual([103, 106]);
  });

  it('should return own trade values, public culture, basic city facts and original source IDs', async () => {
    await db.updateTable('PlayerSummaries').set({ Spies: JSON.stringify({
      Envoy: { Role: 'Diplomat', State: 'Schmoozing', Location: 'Port (Civ1)', Network: 200 }
    }) }).where('ID', '=', 5).execute();
    const result = await queryNewspaperEvidence(db, request);
    expect(result.players.map(row => row.subjectID)).toEqual([0, 1]);
    expect(result.players[0].values.OutgoingTradeRoutes).toEqual({ 'Home => Port (Civ1)': { FromGold: 0, ToFood: -1 } });
    expect(result.players[0].values).toHaveProperty('FoundedReligion', null);
    expect(result.players[1].values).toMatchObject({ CulturePerTurn: 9, TourismPerTurn: 0, PolicyBranches: { Tradition: ['A', 'B'] } });
    expect(result.players[1].values).not.toHaveProperty('Gold');
    expect(result.comparisons.players.find(row => row.subjectID === 1)?.values.PolicyBranches).toEqual({ Tradition: 2 });
    expect(result.cities[0]).toMatchObject({ subjectID: 42, source: { id: 21 }, values: { Population: 0, HitPoints: 0, MajorityReligion: null, IsPuppet: 0, IsCapital: 1, Wonders: ['Beacon'] } });
    expect(result.cities[0].values).not.toHaveProperty('FoodPerTurn');
  });

  it('should omit unknown historical access and avoid retrospective contact grants', async () => {
    await event(db, 107, 10, 'ReligionFounded', { PlayerID: 3, ReligionID: 4 });
    await event(db, 108, 10, 'DeclareWar', { OriginatingPlayerID: 3, TargetTeamID: 0, IsAggressor: true, OriginatingPlayer: { Name: 'Leader3', Civilization: 'Civ3' } });
    const before = await queryNewspaperEvidence(db, request);
    expect(before.events.map(row => row.source.id)).not.toContain(107);
    expect(before.events.find(row => row.source.id === 108)?.values).toEqual({ OriginatingPlayerID: 3, TargetTeamID: 0, IsAggressor: true });
    await event(db, 109, 10, 'MakePeace', { OriginatingPlayerID: 3, TargetTeamID: 0, OriginatingPlayer: { Name: 'Leader3', Civilization: 'Civ3' } });
    await event(db, 112, 10, 'MakePeace', { OriginatingPlayerID: 3, TargetTeamID: 5 });
    const peace = await queryNewspaperEvidence(db, request);
    expect(peace.events.find(row => row.source.id === 109)?.values).toEqual({ OriginatingPlayerID: 3, TargetTeamID: 0 });
    expect(peace.events.map(row => row.source.id)).not.toContain(112);
    await summary(db, 8, 3, 11, 1, { CulturePerTurn: 12 });
    const later = await queryNewspaperEvidence(db, { ...request, cutoffTurn: 11 });
    expect(later.events.map(row => row.source.id)).not.toContain(107);
  });

  it('should use the final same-turn contact summary for a meeting and subsequent events', async () => {
    await summary(db, 8, 2, 10, 0);
    await event(db, 110, 10, 'TeamMeet', { CurrentTeamID: 0, OtherTeamID: 2,
      CurrentTeam: { Player_0: 'Leader0' }, OtherTeam: { Player_2: 'Leader2' } });
    await event(db, 111, 10, 'ReligionFounded', { PlayerID: 2, ReligionID: 4,
      Player: { Name: 'Leader2', Civilization: 'Civ2' } });
    expect((await queryNewspaperEvidence(db, request)).events.map(row => row.source.id)).not.toContain(110);
    await summary(db, 9, 2, 10, 1);
    const result = await queryNewspaperEvidence(db, request);
    expect(result.events.map(row => row.source.id)).toEqual(expect.arrayContaining([110, 111]));
  });

  it('should keep earlier results unchanged after future rows or restricted fields are added', async () => {
    const before = await queryNewspaperEvidence(db, request);
    await summary(db, 90, 1, 30, 2, { CulturePerTurn: 1000, DiplomatPoints: { Player2: 900 } });
    await event(db, 200, 30, 'TeamSetEra', { TeamID: 0, NewEra: 6 });
    await db.updateTable('PlayerSummaries').set({ Gold: 100000, Spies: JSON.stringify({ Secret: { Location: 'Unknown' } }) }).where('Key', '=', 1).execute();
    await db.updateTable('CityInformations').set({ FoodPerTurn: 100000 }).execute();
    expect(await queryNewspaperEvidence(db, request)).toEqual(before);
  });

  it('should use dated diplomat points for private event terms and avoid later strength granting older facts', async () => {
    await summary(db, 8, 2, 5, 1);
    await summary(db, 9, 0, 10, 2, { Spies: {
      Envoy1: { Role: 'Diplomat', State: 'Schmoozing', Location: 'Port (Civ1)', Network: 800 },
      Envoy2: { Role: 'Diplomat', State: 'Schmoozing', Location: 'Capital (Civ2)', Network: 800 }
    } });
    const city = await db.selectFrom('CityInformations').selectAll().executeTakeFirstOrThrow();
    await db.insertInto('CityInformations').values({ ...city, ID: 22, Key: 43, Owner: 'Civ2', Name: 'Capital', X: 1 } as any).execute();
    const payload = { FromPlayerID: 1, ToPlayerID: 2, StartTurn: 10, PeaceTreatyType: 0,
      FromPlayer: { Name: 'Leader1', Civilization: 'Civ1' }, ToPlayer: { Name: 'Leader2', Civilization: 'Civ2' },
      FromGives: ['40 Gold'], ToGives: {},
      TurnsRemaining: -1, TradedItems: [{ FromPlayerID: 1, ItemType: 'Gold', Data1: 40, Data2: 0, Data3: 0, Duration: 0 }] };
    await event(db, 107, 10, 'DealMade', payload);
    await event(db, 108, 11, 'DealMade', payload);
    const result = await queryNewspaperEvidence(db, { ...request, cutoffTurn: 11 });
    const older = result.events.find(row => row.source.id === 107)!;
    const newer = result.events.find(row => row.source.id === 108)!;
    for (const key of ['FromGives', 'ToGives', 'TurnsRemaining', 'TradedItems']) expect(older.values).not.toHaveProperty(key);
    expect(newer.values).toMatchObject(payload);
  });

  it('should omit comparison reads when none are requested', async () => {
    const { comparisonRange: _range, ...latestOnly } = request;
    expect((await queryNewspaperEvidence(db, latestOnly)).comparisons).toEqual({ players: [], cities: [] });
  });

  it('should reject invalid perspectives and ranges before querying', () => {
    for (const invalid of [
      { ...request, receiverPlayerID: 22 }, { ...request, cutoffTurn: 4 },
      { ...request, comparisonRange: { fromTurn: 9, toTurn: 8 } },
      { ...request, comparisonRange: { fromTurn: 0, toTurn: 11 } }
    ]) expect(newspaperEvidenceRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('should publish an unwitnessed researched technology for a met team in reduced form', async () => {
    await event(db, 120, 10, 'TeamTechResearched', { TeamID: 1, TechID: 'Printing Press', ChangeAmount: 3 }, 0);
    const projected = (await queryNewspaperEvidence(db, request)).events.find(row => row.source.id === 120)!;
    expect(projected.values).toEqual({ TeamID: 1, Tech: 'Printing Press' });
  });

  it('should withhold world news for unknown or partially known teams and use contact at the event turn', async () => {
    await event(db, 120, 10, 'TeamTechResearched', { TeamID: 7, TechID: 'Pottery', ChangeAmount: 1 }, 0);
    await db.insertInto('PlayerInformations').values([
      { Key: 4, TeamID: 9, Civilization: 'Civ4', Leader: 'Leader4', IsMajor: 1, IsHuman: 0, Data: {} },
      { Key: 5, TeamID: 9, Civilization: 'Civ5', Leader: 'Leader5', IsMajor: 1, IsHuman: 0, Data: {} }
    ] as any).execute();
    await summary(db, 20, 4, 10, 1);
    await summary(db, 21, 5, 10, 0);
    await event(db, 121, 10, 'TeamTechResearched', { TeamID: 9, TechID: 'Pottery', ChangeAmount: 1 }, 0);
    await summary(db, 22, 2, 9, 1);
    await event(db, 122, 8, 'TeamTechResearched', { TeamID: 2, TechID: 'Pottery', ChangeAmount: 1 }, 0);
    await event(db, 123, 10, 'TeamTechResearched', { TeamID: 2, TechID: 'Writing', ChangeAmount: 1 }, 0);

    const ids = (await queryNewspaperEvidence(db, request)).events.map(row => row.source.id);
    expect(ids).not.toContain(120);
    expect(ids).not.toContain(121);
    expect(ids).not.toContain(122);
    expect(ids).toContain(123);
  });

  it('should deduplicate witnessed world news, respect the window and withhold private events and losses', async () => {
    await event(db, 120, 10, 'TeamTechResearched', { TeamID: 1, TechID: 'Pottery', ChangeAmount: 4 }, 1);
    await event(db, 121, 10, 'TeamSetHasTech', { TeamID: 1, TechID: 'Writing', HasTech: true }, 0);
    await event(db, 122, 10, 'ReligionFounded', { PlayerID: 1, ReligionID: 'Buddhism' }, 0);
    await event(db, 123, 9, 'TeamTechResearched', { TeamID: 1, TechID: 'Writing', ChangeAmount: 1 }, 0);
    await event(db, 124, 10, 'TeamTechResearched', { TeamID: 1, TechID: 'Writing', ChangeAmount: -1 }, 0);

    const result = await queryNewspaperEvidence(db, { ...request, previousCheckTurn: 9, historyFromTurn: 5 });
    expect(result.events.filter(row => row.source.id === 120)).toHaveLength(1);
    expect(result.events.find(row => row.source.id === 120)?.values)
      .toEqual({ TeamID: 1, Tech: 'Pottery', ChangeAmount: 4 });
    expect(result.events.map(row => row.source.id)).not.toContain(121);
    expect(result.events.map(row => row.source.id)).not.toContain(122);
    expect(result.events.map(row => row.source.id)).not.toContain(123);
    expect(result.events.map(row => row.source.id)).not.toContain(124);
    expect(result.history?.events.find(row => row.source.id === 123)?.values).toEqual({ TeamID: 1, Tech: 'Writing' });
    const ids = result.events.map(row => row.source.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });
});
