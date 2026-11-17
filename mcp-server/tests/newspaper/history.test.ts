import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../../src/knowledge/schema/base.js';
import { newspaperEvidenceSchema } from '../../src/newspaper/evidence.js';
import { queryNewspaperEvidence } from '../../src/newspaper/queries.js';
import { createEvidenceDatabase, event, seedEvidence, summary } from './fixtures.js';

const request = { receiverPlayerID: 0, previousCheckTurn: 8, cutoffTurn: 10, historyFromTurn: 5 };
let db: Kysely<KnowledgeDatabase>;

beforeEach(async () => { db = await createEvidenceDatabase(); await seedEvidence(db); });
afterEach(async () => { await db.destroy(); });

/** Record a city change using the fixture's original city data and separate access levels. */
async function cityAt(id: number, turn: number, values: Record<string, unknown> = {}): Promise<void> {
  const city = await db.selectFrom('CityInformations').selectAll().where('ID', '=', 21).executeTakeFirstOrThrow();
  await db.insertInto('CityInformations').values({ ...city, ID: id, Turn: turn, CreatedAt: 3010 + turn, ...values } as any)
    .execute();
}

describe('trigger evidence windows', () => {
  it('should return independent reporting events, chronological history and one dated baseline per subject', async () => {
    await summary(db, 8, 3, 2, 1);
    await cityAt(24, 2);
    await cityAt(25, 3, { Key: 43 });
    await cityAt(26, 5);
    await cityAt(27, 5);
    await cityAt(28, 11, { Key: 43 });
    await event(db, 107, 7, 'TeamSetEra', { TeamID: 0, NewEra: 2 });
    await event(db, 109, 6, 'TeamSetEra', { TeamID: 0, NewEra: 2 });

    const result = await queryNewspaperEvidence(db, request);
    expect(result.events.map(row => row.source.id)).toEqual([103, 106]);
    expect(result.history).toMatchObject({ fromTurn: 5, gaps: [] });
    expect(result.history!.events.map(row => row.source.id)).toEqual([102, 109, 107, 103, 106]);
    expect(result.history!.baseline.players.map(row => [row.subjectID, row.source.id, row.source.turn]))
      .toEqual([[0, 1, 5], [1, 2, 5], [3, 8, 2]]);
    expect(result.history!.baseline.cities.map(row => [row.subjectID, row.source.id, row.source.turn]))
      .toEqual([[42, 27, 5], [43, 25, 3]]);
    expect(result.history!.snapshots.players.map(row => row.source.id)).toEqual([5, 6]);
    expect(result.history!.snapshots.cities.map(row => row.source.id)).toEqual([21]);
    expect(result.comparisons).toEqual({ players: [], cities: [] });
    expect(newspaperEvidenceSchema.parse(result)).toEqual(result);
  });

  it('should cover the preceding check and allow an initial check with turn zero observations', async () => {
    const shorter = await queryNewspaperEvidence(db, { ...request, historyFromTurn: 9 });
    expect(shorter.history!.fromTurn).toBe(8);
    expect(shorter.history!.baseline.players.map(row => row.source.id)).toEqual([1, 2]);
    expect(shorter.history!.events).toEqual(shorter.events);

    await summary(db, 8, 0, 0, 2);
    await event(db, 100, 0, 'TeamSetEra', { TeamID: 0, NewEra: 0 });
    const initial = await queryNewspaperEvidence(db, { ...request, previousCheckTurn: -1, cutoffTurn: 0, historyFromTurn: 0 });
    expect(initial.history).toMatchObject({ fromTurn: -1, baseline: { players: [], cities: [] } });
    expect(initial.history!.snapshots.players.map(row => row.source.id)).toEqual([8]);
    expect(initial.history!.events.map(row => row.source.id)).toEqual([100]);

    const early = await queryNewspaperEvidence(db, { ...request, historyFromTurn: -1 });
    expect(early.history!.baseline).toEqual({ players: [], cities: [] });
    expect(early.history!.events[0].source.id).toBe(100);
    expect(early.events.map(row => row.source.id)).not.toContain(100);
  });

  it('should expose only known gaps and dated fields to each receiver', async () => {
    await summary(db, 8, 3, 4, 1, { Player1: 0 });
    await summary(db, 9, 3, 5, 0, { Player1: 0 });
    await summary(db, 10, 1, 7, 1, { Player1: 2, CulturePerTurn: 27 });
    await summary(db, 11, 1, 7, 0, { Player1: 2, CulturePerTurn: 77 });
    await summary(db, 12, 1, 8, 0, { Player1: 2, CulturePerTurn: 88 });
    await summary(db, 13, 1, 10, 1, { Player1: 2 });
    await summary(db, 14, 2, 7, 0, { Player1: 0 });
    await db.updateTable('PlayerSummaries').set({ Player1: 2 }).where('ID', '=', 2).execute();
    await cityAt(22, 5, { Player0: 2, Player1: 1, FoodPerTurn: 5 });
    await cityAt(23, 7, { Player0: 0, Player1: 2, FoodPerTurn: 7 });
    await cityAt(24, 8, { Key: 99, Player0: 0, Player1: 0 });
    await cityAt(25, 10, { Player0: 1, Player1: 2, FoodPerTurn: 10 });
    await event(db, 108, 7, 'TeamSetEra', { TeamID: 1, NewEra: 3 }, 0);
    await db.updateTable('GameEvents').set({ Player1: 1 }).where('ID', '=', 108).execute();

    const denied = (await queryNewspaperEvidence(db, request)).history!;
    const allowed = (await queryNewspaperEvidence(db, { ...request, receiverPlayerID: 1 })).history!;
    expect(denied.baseline.players.map(row => row.subjectID)).toEqual([0, 1]);
    expect(denied.gaps).toEqual([
      { table: 'PlayerSummaries', subjectID: 1, turn: 7 },
      { table: 'CityInformations', subjectID: 42, turn: 7 }
    ]);
    expect(denied.snapshots.players.map(row => row.source.id)).toEqual([5, 13]);
    expect(denied.baseline.cities[0].values.FoodPerTurn).toBe(5);
    expect(denied.snapshots.cities.map(row => row.source.id)).toEqual([25]);
    expect(denied.snapshots.cities[0].values).not.toHaveProperty('FoodPerTurn');
    expect(denied.events.map(row => row.source.id)).not.toContain(108);
    expect(allowed.baseline.cities[0].values).not.toHaveProperty('FoodPerTurn');
    expect(allowed.snapshots.cities.map(row => row.values.FoodPerTurn)).toEqual([7, 10]);
    expect(allowed.snapshots.players.map(row => row.source.id)).toEqual([11, 12, 13]);
    expect(allowed.events.map(row => row.source.id)).toEqual([108]);
    expect(allowed.gaps).toEqual([]);
  });

  it('should not carry a stale city through a recorded removal', async () => {
    await summary(db, 8, 1, 2, 1);
    await cityAt(22, 2, { Player1: 1 });
    await cityAt(23, 2, { Key: 43, X: 3, Player1: 1 });
    await event(db, 110, 3, 'CityRazed', { PlayerID: 1, CityX: 0, CityY: 4 });
    await event(db, 111, 8, 'CityRazed', { PlayerID: 1, CityX: 3, CityY: 4 });
    await event(db, 112, 9, 'CityRazed', { PlayerID: 1, CityX: 3, CityY: 4 }, 0);

    const known = (await queryNewspaperEvidence(db, request)).history!;
    expect(known.baseline.cities.map(row => row.subjectID)).toEqual([43]);
    expect(known.gaps).toEqual([{ table: 'CityInformations', subjectID: 43, turn: 8 }]);
    expect(known.snapshots.cities.map(row => row.subjectID)).toEqual([42]);
    const other = (await queryNewspaperEvidence(db, { ...request, receiverPlayerID: 1 })).history!;
    expect(other.baseline.cities.map(row => row.subjectID)).toEqual([42, 43]);
    expect(other.gaps).toEqual([{ table: 'CityInformations', subjectID: 42, turn: 10 }]);
    expect(other.events).toEqual([]);
  });

  it('should preserve ownership barriers across window choices even without new events', async () => {
    await db.updateTable('PlayerInformations').set({ IsMajor: 0 }).where('Key', '=', 2).execute();
    await summary(db, 8, 2, 1, 1);
    await summary(db, 9, 2, 10, 1);
    await db.updateTable('CityInformations').set({ Name: 'Civ2', Owner: 'City-States' }).where('ID', '=', 21).execute();
    await cityAt(22, 2);
    await cityAt(23, 7, { Player0: 0 });

    const input = { receiverPlayerID: 0, previousCheckTurn: 10, cutoffTurn: 10 };
    const noWindow = await queryNewspaperEvidence(db, input);
    expect(noWindow.events).toEqual([]);
    expect(noWindow.cities[0].values).not.toHaveProperty('OwnerID');
    for (const historyFromTurn of [10, 1]) {
      const result = await queryNewspaperEvidence(db, { ...input, historyFromTurn });
      expect(result.cities).toEqual(noWindow.cities);
    }
  });

  it('should end a visible city anonymously when a capture names an uncontacted party', async () => {
    await cityAt(22, 2, { Key: 43, X: 3, Player1: 1 });
    await cityAt(23, 2, { Key: 44, X: 4, Player0: 0 });
    await event(db, 110, 7, 'CityCaptureComplete', { OldOwnerID: 1, NewOwnerID: 3, CityX: 3, CityY: 4 });
    await event(db, 111, 7, 'CityCaptureComplete', { OldOwnerID: 1, NewOwnerID: 3, CityX: 4, CityY: 4 });
    await summary(db, 8, 3, 10, 1);

    const observed = await queryNewspaperEvidence(db, { ...request, previousCheckTurn: 6 });
    expect(observed.cities.map(row => row.subjectID)).toEqual([42]);
    expect(observed.history!.baseline.cities.map(row => row.subjectID)).toEqual([43]);
    expect(observed.history!.gaps).toEqual([{ table: 'CityInformations', subjectID: 43, turn: 7 }]);
    expect([...observed.events, ...observed.history!.events].map(row => row.type)).not.toContain('CityCaptureComplete');
    expect(observed.history!.baseline.cities[0]).not.toHaveProperty('relatedSources');

    const after = await queryNewspaperEvidence(db, { ...request, historyFromTurn: 8 });
    expect(after.cities.map(row => row.subjectID)).toEqual([42]);
    expect(after.history!.baseline.cities).toEqual([]);
    expect(after.history!.gaps).toEqual([]);

    const unseen = await queryNewspaperEvidence(db, { ...request, receiverPlayerID: 1 });
    expect(unseen.cities.map(row => row.subjectID)).toEqual([43]);
    expect(unseen.history!.baseline.cities.map(row => row.subjectID)).toEqual([43]);
    expect(unseen.history!.gaps).toEqual([]);
    expect(unseen.history!.events).toEqual([]);
  });

  it('should resolve stale cities with contact on their own distinct observation turns', async () => {
    await summary(db, 8, 1, 0, 1);
    await summary(db, 9, 2, 9, 1);
    await cityAt(22, 2, { Key: 43, X: 3 });
    await cityAt(23, 3, { Key: 44, X: 4, Owner: 'Civ2' });
    await cityAt(24, 4, { Key: 45, X: 5, Player0: 0 });
    await cityAt(25, 4, { Key: 46, X: 6 });
    await event(db, 110, 6, 'CityRazed', { PlayerID: 1, CityX: 6, CityY: 4 });

    const result = await queryNewspaperEvidence(db, { ...request, previousCheckTurn: 9, historyFromTurn: 8 });
    const stale = result.cities.filter(row => row.subjectID !== 42);
    expect(stale.map(row => row.subjectID)).toEqual([43, 44]);
    expect(stale[0].values.OwnerID).toBe(1);
    expect(stale[1].values).not.toHaveProperty('OwnerID');
    expect(result.history!.baseline.cities).toEqual(stale);
  });
});
