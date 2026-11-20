import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../../src/knowledge/schema/base.js';
import { newspaperEvidenceSchema } from '../../src/newspaper/evidence.js';
import { queryNewspaperEvidence } from '../../src/newspaper/queries.js';
import { createEvidenceDatabase, seedEvidence } from './fixtures.js';

const request = { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10 };
let db: Kysely<KnowledgeDatabase>;
beforeEach(async () => { db = await createEvidenceDatabase(); await seedEvidence(db); });
afterEach(async () => { await db.destroy(); });

/** A valid diplomatic record with only the fields the newspaper reads. */
function diplomatic(status: string, votesNeeded = 10) {
  return { VotesNeeded: votesNeeded, Status: status, Proposals: {}, ActiveResolutions: {} };
}

/** Insert one recorded victory-progress row for the global Congress snapshot. */
async function progress(
  database: Kysely<KnowledgeDatabase>, id: number, turn: number, value: unknown, createdAt = 4000 + turn
): Promise<void> {
  await database.insertInto('VictoryProgress').values({
    ID: id, Key: 0, Turn: turn, Version: id, IsLatest: 0, CreatedAt: createdAt,
    Payload: {}, Changes: [],
    DominationVictory: 'Not available', ScienceVictory: 'Not available', CulturalVictory: 'Not available',
    DiplomaticVictory: typeof value === 'string' ? value : JSON.stringify(value)
  } as any).execute();
}

describe('public Congress evidence', () => {
  it('should keep the latest usable baseline, one final observation per turn, and original citations', async () => {
    await progress(db, 500, 4, diplomatic('World Congress - Voting in 4 turns', 8), 4104);
    await progress(db, 501, 5, {
      VotesNeeded: 12, Status: 'United Nations - Voting Now', Proposals: {}, ActiveResolutions: {}
    }, 4105);
    await progress(db, 510, 6, { VotesNeeded: 12, Proposals: {} }, 4106);
    await progress(db, 511, 7, {
      VotesNeeded: 10,
      Status: 'World Congress - Voting in 2 turns',
      Proposals: {
        'Enact: World Religion': { Proposer: 'Leader1', Description: 'Choose a religion' },
        'Repeal: Arts Funding': { Proposer: 'Leader2' }
      },
      ActiveResolutions: {
        'World Religion': { Description: 'Choose a religion', EnactedOn: 2 },
        'Open Borders': { Description: '', EnactedOn: 0 }
      }
    }, 4107);
    await progress(db, 512, 8, diplomatic('World Congress - Voting in 3 turns'), 4108);
    await progress(db, 513, 8, { Status: 'World Congress - Voting in 1 turn', Proposals: {} }, 4109);
    await progress(db, 514, 10, 'Unlocked in Atomic or Information eras', 4110);
    await progress(db, 515, 11, diplomatic('World Congress - Voting Now'), 4111);

    const result = await queryNewspaperEvidence(db, request);
    expect(result.congress?.baseline).toMatchObject({
      source: { table: 'VictoryProgress', id: 501, turn: 5, createdAt: 4105 },
      available: true, league: 'United Nations', votingNow: true,
      diplomaticVictoryVotesNeeded: 12, proposals: [], activeResolutions: []
    });
    expect(result.congress?.observations.map(row => row.source.id)).toEqual([511, 513, 514]);

    const proposed = result.congress!.observations[0]!;
    expect(proposed).toMatchObject({
      source: { table: 'VictoryProgress', id: 511, turn: 7, createdAt: 4107 },
      league: 'World Congress', votingNow: false, expectedSessionTurn: 9, diplomaticVictoryVotesNeeded: 10
    });
    expect(proposed.proposals).toEqual([
      { name: 'World Religion', isEnact: true, proposer: 'Leader1', description: 'Choose a religion' },
      { name: 'Arts Funding', isEnact: false, proposer: 'Leader2' }
    ]);
    expect(proposed.activeResolutions).toEqual([
      { name: 'World Religion', description: 'Choose a religion', enactedTurn: 2 },
      { name: 'Open Borders', description: '' }
    ]);

    const sparse = result.congress!.observations[1]!;
    expect(sparse).toMatchObject({ expectedSessionTurn: 9, proposals: [] });
    expect(sparse).not.toHaveProperty('diplomaticVictoryVotesNeeded');
    expect(result.congress!.observations[2]).toMatchObject({
      source: { turn: 10 }, available: false, votingNow: false, proposals: [], activeResolutions: []
    });
    expect(newspaperEvidenceSchema.parse(result)).toEqual(result);
  });

  it('should omit Congress evidence when the archive has no usable table or rows', async () => {
    const empty = await queryNewspaperEvidence(db, request);
    expect(empty).not.toHaveProperty('congress');
    expect(newspaperEvidenceSchema.parse(empty)).toEqual(empty);

    await db.schema.dropTable('VictoryProgress').execute();
    const missingTable = await queryNewspaperEvidence(db, request);
    expect(missingTable).not.toHaveProperty('congress');
    expect(missingTable.players.length).toBeGreaterThan(0);
  });

  it('should omit Congress evidence when an older archive table lacks the diplomatic column', async () => {
    await db.schema.dropTable('VictoryProgress').execute();
    await db.schema.createTable('VictoryProgress')
      .addColumn('ID', 'integer', column => column.primaryKey().autoIncrement())
      .addColumn('Key', 'integer', column => column.notNull())
      .addColumn('Turn', 'integer', column => column.notNull())
      .addColumn('CreatedAt', 'integer', column => column.notNull())
      .execute();

    const result = await queryNewspaperEvidence(db, request);
    expect(result).not.toHaveProperty('congress');
  });

  it('should fall back to an earlier baseline and retain timing from an incomplete agenda', async () => {
    await progress(db, 600, 4, diplomatic('World Congress - Voting in 3 turns'), 4204);
    await progress(db, 601, 5, { Status: 'Congress is thinking', Proposals: {} }, 4205);
    await progress(db, 602, 7, diplomatic('World Congress - Voting in 1 turn'), 4207);
    await progress(db, 603, 7, { Proposals: {} }, 4208);
    await progress(db, 604, 8, 'Not available', 4209);
    await progress(db, 605, 9, 'Congress is thinking', 4210);
    await progress(db, 606, 10, { Status: 'World Congress - Voting in 2 turns', Proposals: 'invalid' }, 4211);

    const result = await queryNewspaperEvidence(db, request);
    expect(result.congress?.baseline?.source.id).toBe(600);
    expect(result.congress?.observations).toMatchObject([{ source: { id: 606 }, expectedSessionTurn: 12 }]);
    expect(result.congress?.observations[0]).not.toHaveProperty('proposals');
  });

  it('should keep a known locked baseline when no later observation exists', async () => {
    await progress(db, 800, 4, 'Unlocked in Atomic or Information eras', 4404);

    const result = await queryNewspaperEvidence(db, request);
    expect(result.congress?.baseline).toMatchObject({
      source: { table: 'VictoryProgress', id: 800, turn: 4, createdAt: 4404 },
      available: false, votingNow: false, proposals: [], activeResolutions: []
    });
    expect(result.congress?.observations).toEqual([]);
  });

  it('should not treat comparison or history turns as new Congress observations', async () => {
    await progress(db, 700, 3, diplomatic('World Congress - Voting in 4 turns'), 4303);
    await progress(db, 701, 5, diplomatic('World Congress - Voting in 2 turns'), 4305);
    await progress(db, 702, 6, diplomatic('World Congress - Voting Now'), 4306);

    const result = await queryNewspaperEvidence(db, {
      ...request, historyFromTurn: 3, comparisonRange: { fromTurn: 3, toTurn: 10 }
    });
    expect(result.congress?.baseline?.source.id).toBe(701);
    expect(result.congress?.observations.map(row => row.source.id)).toEqual([702]);
  });
});
