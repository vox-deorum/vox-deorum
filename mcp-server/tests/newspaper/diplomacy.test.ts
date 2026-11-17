import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../../src/knowledge/schema/base.js';
import { queryNewspaperEvidence } from '../../src/newspaper/queries.js';
import { newspaperEvidenceSchema } from '../../src/newspaper/evidence.js';
import { createEvidenceDatabase, event, seedEvidence, summary } from './fixtures.js';

let db: Kysely<KnowledgeDatabase>;
beforeEach(async () => { db = await createEvidenceDatabase(); await seedEvidence(db); });
afterEach(async () => { await db.destroy(); });
const request = { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10 };

describe('dated public diplomacy evidence', () => {
  it('includes the original baseline and full window history independently of comparison reads', async () => {
    await db.updateTable('PlayerSummaries').set({ Relationships: JSON.stringify({ Civ1: ['War (Our Score: -5%; Our War Weariness: 88%)'] }) }).where('ID', '=', 1).execute();
    await summary(db, 20, 0, 7, 2, { Relationships: { Civ1: ['War (Our Score: 0%; Our War Weariness: 12%)'] } });
    await summary(db, 21, 0, 8, 2, { Relationships: { Civ1: ['Distance: Close', 'Peace Treaty'] } });
    const result = await queryNewspaperEvidence(db, request);
    expect(result.diplomacy?.fromTurn).toBe(6);
    expect(result.diplomacy?.baseline.find(row => row.subjectID === 0)).toMatchObject({
      source: { table: 'PlayerSummaries', id: 1, turn: 5, createdAt: 1005 },
      subjectID: 0, teamID: 0, isMajor: true,
      relationships: [{ targetPlayerID: 1, targetTeamID: 1, state: 'war', warScore: -5 }]
    });
    expect(result.diplomacy?.history.filter(row => row.subjectID === 0).map(row => [row.source.turn, row.relationships[0]?.state])).toEqual([
      [7, 'war'], [8, 'peace'], [10, undefined]
    ]);
    expect(result.comparisons.players).toEqual([]);
    expect(result.players.every(row => !('Relationships' in row.values))).toBe(true);
    expect(newspaperEvidenceSchema.parse(result)).toEqual(result);
  });

  it('gates individual minor relationships and allies with the contact recorded on their own turn', async () => {
    await db.insertInto('PlayerInformations').values({ Key: 22, TeamID: 22, Civilization: 'Geneva', Leader: 'Geneva', IsMajor: 0, IsHuman: 0, Data: {} } as any).execute();
    await summary(db, 20, 22, 5, 1, { MajorAlly: 'Civ1', Relationships: {
      Civ0: 'Neutral (Influence: 0, Distance: Close)',
      Civ1: 'Ally (Influence: 155, Distance: Close)',
      Civ2: 'Permanent War (Influence: -100, Distance: Far)'
    } });
    await summary(db, 21, 2, 9, 1);
    await summary(db, 22, 22, 9, 1, { MajorAlly: 'Civ2', Relationships: { Civ2: 'War - Peace Currently Blocked (Influence: -22, Distance: Close)' } });
    const result = await queryNewspaperEvidence(db, request);
    const baseline = result.diplomacy!.baseline.find(row => row.subjectID === 22)!;
    expect(baseline.majorAllyPlayerID).toBe(1);
    expect(baseline.relationships.map(row => row.targetPlayerID)).toEqual([0, 1]);
    expect(baseline.relationships[1]).toMatchObject({ ally: true, state: 'peace' });
    expect(result.diplomacy!.history.find(row => row.subjectID === 22)).toMatchObject({
      majorAllyPlayerID: 2, relationships: [{ targetPlayerID: 2, state: 'war' }]
    });
    expect(JSON.stringify(result.diplomacy)).not.toMatch(/Influence|155|-100/);
    expect(result.limitations).toBeUndefined();
    expect(result.diplomacy!.gaps).toContainEqual(expect.objectContaining({ subjectID: 22, kind: 'unresolvedIdentity', source: expect.objectContaining({ turn: 5 }) }));
  });

  it('keeps ambiguous names and empty entries unknown and does not replace hidden final rows', async () => {
    await db.updateTable('PlayerInformations').set({ Civilization: 'Civ1' }).where('Key', '=', 2).execute();
    await summary(db, 20, 2, 5, 1);
    await summary(db, 19, 2, 6, 0);
    await summary(db, 21, 0, 7, 2, { Relationships: { Civ1: ['Defensive Pact'], Civ3: ['War'], Missing: ['War'] } });
    await summary(db, 22, 0, 8, 2, { Relationships: { Civ1: [] } });
    await summary(db, 23, 1, 9, 1, { Relationships: { Civ0: ['Peace Treaty'] } });
    await summary(db, 24, 1, 9, 0, { Relationships: { Civ0: ['War'] } });
    const result = await queryNewspaperEvidence(db, request);
    expect(result.diplomacy!.history.filter(row => row.subjectID === 0).every(row => row.relationships.length === 0)).toBe(true);
    expect(result.diplomacy!.gaps).toContainEqual(expect.objectContaining({ kind: 'ambiguousIdentity' }));
    expect(result.diplomacy!.history.find(row => row.source.id === 21)?.relationships).toEqual([]);
    expect(result.diplomacy!.history.some(row => row.source.id === 23 || row.source.id === 24)).toBe(false);
    await db.updateTable('PlayerInformations').set({ Civilization: 'Civ2' }).where('Key', '=', 2).execute();
    expect((await queryNewspaperEvidence(db, request)).diplomacy!.history.find(row => row.source.id === 22)?.relationships).toEqual([
      { targetPlayerID: 1, targetTeamID: 1, state: 'unknown' }
    ]);
  });

  it('projects alliance changes without influence and preserves native IDs within a turn', async () => {
    await event(db, 200, 8, 'SetAlly', { MinorPlayerID: 1, OldAllyPlayerID: -1, NewAllyPlayerID: 0, Private: 'secret' });
    await event(db, 201, 8, 'MinorAlliesChanged', { MinorPlayerID: 1, MajorPlayerID: 0, IsNowAlly: 1, OldFriendship: 50, NewFriendship: 99 });
    await event(db, 202, 8, 'DeclareWar', { OriginatingPlayerID: 1, TargetTeamID: 0, IsAggressor: true });
    const result = await queryNewspaperEvidence(db, request);
    expect(result.events.filter(row => row.source.turn === 8).map(row => row.source.id)).toEqual([200, 201, 202]);
    expect(result.events.find(row => row.source.id === 200)?.values).toEqual({ MinorPlayerID: 1, OldAllyPlayerID: -1, NewAllyPlayerID: 0 });
    expect(result.events.find(row => row.source.id === 201)?.values).toEqual({ MinorPlayerID: 1, MajorPlayerID: 0, IsNowAlly: true });
  });

  it.each([{}, []])('accepts an empty relationship collection without a missing-data gap: %j', async relationships => {
    await summary(db, 20, 0, 8, 2, { Relationships: relationships });
    const result = await queryNewspaperEvidence(db, request);
    expect(result.diplomacy!.history.find(row => row.source.id === 20)?.relationships).toEqual([]);
    expect(result.diplomacy!.gaps.filter(gap => gap.source.id === 20)).toEqual([]);
  });

  it.each([null, 'invalid'])('records a missing relationship collection for absent or malformed data: %j', async relationships => {
    await summary(db, 20, 0, 8, 2, { Relationships: relationships });
    const result = await queryNewspaperEvidence(db, request);
    expect(result.diplomacy!.gaps.filter(gap => gap.source.id === 20)).toEqual([
      { source: { table: 'PlayerSummaries', id: 20, turn: 8, createdAt: 1008 }, subjectID: 0, kind: 'missingRelationships' }
    ]);
  });

  it('records an unresolved identity when a visible summary has no player information', async () => {
    await db.deleteFrom('PlayerInformations').where('Key', '=', 1).execute();
    const result = await queryNewspaperEvidence(db, request);
    expect(result.diplomacy!.history.some(row => row.subjectID === 1)).toBe(false);
    expect(result.diplomacy!.gaps).toContainEqual({
      source: { table: 'PlayerSummaries', id: 6, turn: 10, createdAt: 1010 }, subjectID: 1, kind: 'unresolvedIdentity'
    });
  });
});
