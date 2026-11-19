import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely, Selectable } from 'kysely';
import type { KnowledgeDatabase } from '../../src/knowledge/schema/base.js';
import type { CityInformation } from '../../src/knowledge/schema/timed.js';
import { newspaperEvidenceSchema } from '../../src/newspaper/evidence.js';
import { queryNewspaperEvidence } from '../../src/newspaper/queries.js';
import { createEvidenceDatabase, event, seedEvidence, summary } from './fixtures.js';

let db: Kysely<KnowledgeDatabase>;
let port: Selectable<CityInformation>;
const request = { receiverPlayerID: 0, previousCheckTurn: 10, cutoffTurn: 12, historyFromTurn: 10 };

beforeEach(async () => {
  db = await createEvidenceDatabase();
  await seedEvidence(db);
  port = await db.selectFrom('CityInformations').selectAll().executeTakeFirstOrThrow();
});
afterEach(async () => { await db.destroy(); });

/** Insert a dated observation of the seeded city or a city that shares some of its fields. */
async function city(overrides: Partial<Selectable<CityInformation>>): Promise<void> {
  await db.insertInto('CityInformations').values({ ...port, ...overrides } as any).execute();
}

/** Record a city-state nation and the turn that establishes the newspaper receiver's contact. */
async function minor(key: number, name: string, turn: number): Promise<void> {
  await db.insertInto('PlayerInformations').values({ Key: key, TeamID: key, Civilization: name, Leader: name, IsMajor: 0, IsHuman: 0, Data: '{}' }).execute();
  await summary(db, 300 + key, key, turn, 1);
}

describe('dated newspaper joins', () => {
  it('joins training to a uniquely matching permitted creation and city, independently for each receiver', async () => {
    await db.updateTable('PlayerSummaries').set({ Player1: 2 }).where('Key', '=', 1).execute();
    await db.updateTable('PlayerSummaries').set({ Player1: 1 }).where('Key', '=', 0).execute();
    await event(db, 201, 11, 'CityTrained', {
      PlayerID: 1, CityID: 42, UnitID: 80, WithGold: false, WithFaith: true, Unit: { UnitType: 'Ambiguous enrichment' }
    });
    await db.updateTable('GameEvents').set({ Player1: 2 }).where('ID', '=', 201).execute();
    await event(db, 202, 11, 'UnitCreated', { PlayerID: 1, UnitID: 80, UnitType: 'Settler' });
    await event(db, 203, 11, 'UnitCreated', { PlayerID: 0, UnitID: 80, UnitType: 'Scout' });
    await event(db, 204, 12, 'UnitCreated', { PlayerID: 1, UnitID: 80, UnitType: 'Warrior' });

    const allowed = newspaperEvidenceSchema.parse(await queryNewspaperEvidence(db, request));
    expect(allowed.events.find(row => row.type === 'CityTrained')).toMatchObject({
      values: { WithGold: false, WithFaith: true, Unit: 'Settler', CityX: 0, CityY: 4 },
      relatedSources: [{ table: 'CityInformations', id: 21, turn: 10 }, { table: 'GameEvents', id: 202, turn: 11 }]
    });
    const denied = await queryNewspaperEvidence(db, { ...request, receiverPlayerID: 1 });
    const observed = denied.events.find(row => row.type === 'CityTrained');
    expect(observed?.values).toMatchObject({ WithGold: false, WithFaith: true });
    for (const key of ['Unit', 'CityX', 'CityY']) expect(observed?.values).not.toHaveProperty(key);
    expect(observed).not.toHaveProperty('relatedSources');

    await event(db, 205, 11, 'UnitCreated', { PlayerID: 1, UnitID: 80, UnitType: 'Archer' });
    const ambiguous = await queryNewspaperEvidence(db, request);
    expect(ambiguous.events.find(row => row.type === 'CityTrained')?.values).not.toHaveProperty('Unit');
  });

  it('uses the city observation before an event and withholds positions at a tie or visibility gap', async () => {
    await event(db, 201, 11, 'CityConstructed', { OwnerID: 1, CityID: 42, BuildingType: 'Shrine' });
    await city({ ID: 22, Turn: 11, CreatedAt: 2010 });
    await city({ ID: 23, Turn: 11, CreatedAt: 2012, Player0: 0 });
    const seen = await queryNewspaperEvidence(db, request);
    expect(seen.events.find(row => row.type === 'CityConstructed')).toMatchObject({
      values: { Building: 'Shrine', CityX: 0, CityY: 4 }, relatedSources: [{ id: 22, turn: 11 }]
    });

    for (const CreatedAt of [2011, 2010]) {
      await db.updateTable('CityInformations').set({ CreatedAt }).where('ID', '=', 23).execute();
      const hidden = await queryNewspaperEvidence(db, request);
      expect(hidden.events.find(row => row.type === 'CityConstructed')?.values).not.toHaveProperty('CityX');
    }
  });

  it('does not guess across competing owner and ID matches or revive a city that was razed', async () => {
    await event(db, 201, 11, 'CityPuppeted', { PlayerID: 1, CityID: 42 });
    await city({ ID: 22, X: 7, Owner: 'Civ0' });
    let evidence = await queryNewspaperEvidence(db, request);
    expect(evidence.events.find(row => row.type === 'CityPuppeted')?.values).toHaveProperty('CityX', 0);

    await db.updateTable('CityInformations').set({ Owner: 'Civ1' }).where('ID', '=', 22).execute();
    evidence = await queryNewspaperEvidence(db, request);
    expect(evidence.events.find(row => row.type === 'CityPuppeted')?.values).not.toHaveProperty('CityX');

    await event(db, 200, 11, 'CityRazed', { PlayerID: 1, CityX: 0, CityY: 4 });
    evidence = await queryNewspaperEvidence(db, request);
    expect(evidence.events.find(row => row.type === 'CityPuppeted')?.values).toHaveProperty('CityX', 7);
  });

  it('prefers a dated city-state transfer to the city name and withholds ownership across a hidden observation', async () => {
    await minor(22, 'Sidon', 8);
    await minor(23, 'Geneva', 8);
    await db.updateTable('CityInformations').set({ Owner: 'City-States', Name: 'Sidon' }).where('ID', '=', 21).execute();
    await event(db, 201, 11, 'CityCaptureComplete', { OldOwnerID: 22, NewOwnerID: 23, CityX: 0, CityY: 4, IsCapital: true });
    await city({ ID: 22, Key: 43, Turn: 12, Owner: 'City-States', Name: 'Sidon' });
    const seen = await queryNewspaperEvidence(db, request);
    expect(seen.history?.baseline.cities.find(row => row.subjectID === 42)?.values).toHaveProperty('OwnerID', 22);
    expect(seen.cities.find(row => row.subjectID === 43)).toMatchObject({
      values: { OwnerID: 23, IsCapital: 1 }, relatedSources: [{ table: 'GameEvents', id: 201, turn: 11 }]
    });

    await city({ ID: 23, Key: 43, Turn: 13, Owner: 'City-States', Name: 'Sidon', Player0: 0 });
    await city({ ID: 24, Key: 43, Turn: 14, Owner: 'City-States', Name: 'Sidon' });
    const gap = await queryNewspaperEvidence(db, { ...request, cutoffTurn: 14 });
    expect(gap.cities.find(row => row.subjectID === 43)?.values).not.toHaveProperty('OwnerID');
  });

  it.each([22, 23])('withholds a city-state transfer when contact with player %i came after the event', async hidden => {
    await minor(22, 'Sidon', hidden === 22 ? 12 : 8);
    await minor(23, 'Geneva', hidden === 23 ? 12 : 8);
    await event(db, 201, 11, 'CityCaptureComplete', { OldOwnerID: 22, NewOwnerID: 23, CityX: 0, CityY: 4 });
    await city({ ID: 22, Key: 43, Turn: 12, Owner: 'City-States', Name: 'Sidon' });
    const evidence = await queryNewspaperEvidence(db, request);
    expect(evidence.events.find(row => row.type === 'CityCaptureComplete')).toBeUndefined();
    expect(evidence.cities.find(row => row.subjectID === 43)?.values).not.toHaveProperty('OwnerID');
  });

  it('preserves a recorded founding event as its own type and can resolve an otherwise ambiguous city-state name', async () => {
    await minor(22, 'Sidon', 8);
    await minor(23, 'Sidon', 8);
    await city({ ID: 22, Key: 43, X: 5, Turn: 12, Owner: 'City-States', Name: 'Sidon' });
    const before = await queryNewspaperEvidence(db, request);
    expect(before.cities.find(row => row.subjectID === 43)?.values).not.toHaveProperty('OwnerID');
    expect(before.events.map(row => row.type)).not.toContain('PlayerCityFounded');

    await event(db, 201, 11, 'UnitCityFounded', { PlayerID: 23, UnitID: 80, UnitType: 'Settler', PlotX: 5, PlotY: 4 });
    const founded = await queryNewspaperEvidence(db, request);
    expect(founded.events.find(row => row.source.id === 201)).toMatchObject({ type: 'UnitCityFounded', values: { PlotX: 5, PlotY: 4 } });
    expect(founded.cities.find(row => row.subjectID === 43)).toMatchObject({
      values: { OwnerID: 23 }, relatedSources: [{ table: 'GameEvents', id: 201 }]
    });
  });
});

describe('newspaper city unhappiness', () => {
  it('reports recorded causes only at full access and keeps an observed empty reading', async () => {
    await city({ ID: 22, Key: 43, Turn: 12, Owner: 'Civ0', Player0: 2, UnhappinessSources: { Culture: 3, Distress: 1 } });
    await city({ ID: 23, Key: 44, Turn: 12, Player0: 1, UnhappinessSources: { Culture: 2 } });
    await city({ ID: 24, Key: 45, Turn: 12, Owner: 'Civ0', Player0: 2, UnhappinessSources: {} });
    await city({ ID: 25, Key: 46, Turn: 12, Owner: 'Civ0', Player0: 2, UnhappinessSources: null });

    const evidence = await queryNewspaperEvidence(db, request);

    const full = evidence.cities.find(row => row.subjectID === 43);
    expect(full?.values.UnhappinessSources).toEqual({ Culture: 3, Distress: 1 });
    expect(full?.source).toMatchObject({ table: 'CityInformations', id: 22, turn: 12 });
    expect(evidence.cities.find(row => row.subjectID === 44)?.values).not.toHaveProperty('UnhappinessSources');
    expect(evidence.cities.find(row => row.subjectID === 45)).toMatchObject({
      values: { UnhappinessSources: {} }, source: { table: 'CityInformations', id: 24, turn: 12 }
    });
    expect(evidence.cities.find(row => row.subjectID === 46)?.values).not.toHaveProperty('UnhappinessSources');
  });

  it('reads old recordings without the causes column', async () => {
    await db.updateTable('CityInformations').set({ Player0: 2, Owner: 'Civ0' }).where('ID', '=', 21).execute();
    await db.schema.alterTable('CityInformations').dropColumn('UnhappinessSources').execute();

    const evidence = await queryNewspaperEvidence(db, request);
    const projected = evidence.cities.find(row => row.subjectID === 42);
    expect(projected?.values).toHaveProperty('HappinessDelta', 0);
    expect(projected?.values).not.toHaveProperty('UnhappinessSources');
  });
});
