import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../../src/knowledge/schema/base.js';
import { readEvents } from '../../src/knowledge/history.js';
import { queryNewspaperEvidence } from '../../src/newspaper/queries.js';
import { createEvidenceDatabase, event, seedEvidence } from './fixtures.js';

const request = { receiverPlayerID: 0, previousCheckTurn: 9, cutoffTurn: 10 };
let db: Kysely<KnowledgeDatabase>;

beforeEach(async () => { db = await createEvidenceDatabase(); await seedEvidence(db); });
afterEach(async () => { await db.destroy(); });

describe('public World Congress outcomes', () => {
  it('should reach every major civilization through dated reads without changing stored flags', async () => {
    await event(db, 300, 10, 'ResolutionResult', {
      ResolutionType: 'World Religion', ProposerPlayerID: 1, Decision: 0, IsEnact: 1, Passed: 0
    }, 0);

    for (const playerID of [0, 1, 2]) {
      const rows = await readEvents(db, { PlayerID: playerID, FromTurn: 10, ToTurn: 10 });
      expect(rows.map(row => row.ID)).toContain(300);
      const evidence = await queryNewspaperEvidence(db, { ...request, receiverPlayerID: playerID });
      expect(evidence.events.find(row => row.source.id === 300)).toMatchObject({
        type: 'ResolutionResult', values: { IsEnact: true, Passed: false }
      });
    }

    const stored = await db.selectFrom('GameEvents').selectAll().where('ID', '=', 300).executeTakeFirstOrThrow();
    expect(stored.Player0).toBe(0);
    expect(stored.Player1 ?? 0).toBe(0);
  });

  it('should preserve the recorded result fields and normalize legacy numeric flags', async () => {
    await event(db, 301, 10, 'ResolutionResult', {
      ResolutionType: 7, ProposerPlayerID: 1, Decision: 0, IsEnact: 0, Passed: 1,
      ProposerPlayer: { Name: 'Leader1', Civilization: 'Civ1' }, Tallies: { For: 10, Against: 2 }
    }, 0);

    const projected = (await queryNewspaperEvidence(db, request)).events.find(row => row.source.id === 301)!;
    expect(projected.source).toMatchObject({ table: 'GameEvents', id: 301, turn: 10, createdAt: 2010 });
    expect(projected.values).toEqual({
      IsEnact: false, Passed: true, ResolutionType: 7, ProposerPlayerID: 1, Decision: 0, ProposerName: 'Civ1'
    });
    expect(projected.values).not.toHaveProperty('Tallies');
  });

  it('should keep unrelated hidden events private', async () => {
    await event(db, 302, 10, 'ReligionFounded', { PlayerID: 1, ReligionID: 'Buddhism' }, 0);

    expect((await readEvents(db, { PlayerID: 0, FromTurn: 10, ToTurn: 10 })).map(row => row.ID)).not.toContain(302);
    expect((await queryNewspaperEvidence(db, request)).events.map(row => row.source.id)).not.toContain(302);
  });
});
