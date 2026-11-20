import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../../src/knowledge/schema/base.js';
import {
  projectCulturalInfluence, readCulturalInfluenceRows,
} from '../../src/newspaper/cultural-influence.js';
import { createEvidenceDatabase } from './fixtures.js';

let db: Kysely<KnowledgeDatabase>;
beforeEach(async () => { db = await createEvidenceDatabase(); });
afterEach(async () => { await db.destroy(); });

/** Insert one public player identity. */
async function identity(
  database: Kysely<KnowledgeDatabase>, key: number, civilization: string, isMajor = 1
): Promise<void> {
  await database.insertInto('PlayerInformations').values({
    Key: key, TeamID: key, Civilization: civilization, Leader: `Leader${key}`,
    IsHuman: 0, IsMajor: isMajor, Data: {}
  } as any).execute();
}

/** Build a cultural victory payload keyed by recorded civilization labels. */
function cultural(influences: Record<string, Record<string, string>>): Record<string, unknown> {
  return {
    CivsNeeded: Math.max(0, Object.keys(influences).length - 1),
    Contender: null,
    ...Object.fromEntries(Object.entries(influences).map(([label, entries]) => [
      label, { InfluentialCivs: 0, Influences: entries, PolicyPercentage: 0 }
    ]))
  };
}

/** Insert one recorded victory-progress row for the global cultural snapshot. */
async function progress(
  database: Kysely<KnowledgeDatabase>, id: number, turn: number, value: unknown, key = 0
): Promise<void> {
  await database.insertInto('VictoryProgress').values({
    ID: id, Key: key, Turn: turn, Version: id, IsLatest: 0, CreatedAt: 4000 + id,
    Payload: {}, Changes: [], DominationVictory: 'Not available', ScienceVictory: 'Not available',
    CulturalVictory: typeof value === 'string' ? value : JSON.stringify(value),
    DiplomaticVictory: 'Not available'
  } as any).execute();
}

/** Read the public player identities for projection. */
async function players() {
  return db.selectFrom('PlayerInformations').selectAll().execute();
}

describe('public cultural influence evidence', () => {
  it('should read the latest baseline and only the final insertion per turn', async () => {
    await progress(db, 10, 3, cultural({ Civ0: { Civ1: 'Exotic (10%) - ' } }));
    await progress(db, 11, 5, cultural({ Civ0: { Civ1: 'Familiar (20%) - ' } }));
    await progress(db, 18, 5, cultural({ Civ0: { Civ1: 'Dominant (200%) - ' } }), 1);
    await progress(db, 12, 6, cultural({ Civ0: { Civ1: 'Familiar (25%) - ' } }));
    await progress(db, 13, 7, cultural({ Civ0: { Civ1: 'Familiar (30%) - ' } }));
    await progress(db, 14, 7, cultural({ Civ0: { Civ1: 'Popular (40%) - ' } }));
    await progress(db, 15, 8, cultural({ Civ0: { Civ1: 'Popular (45%) - ' } }));
    await progress(db, 16, 9, cultural({ Civ0: { Civ1: 'Popular (50%) - ' } }), 1);
    await progress(db, 17, 11, cultural({ Civ0: { Civ1: 'Influential (101%) - ' } }));

    const rows = await readCulturalInfluenceRows(db, 5, 10);
    expect(rows?.map(row => row.ID)).toEqual([11, 12, 14, 15]);
    expect(rows?.[0]).toMatchObject({ Turn: 5, CreatedAt: 4011 });
  });

  it('should return no rows when the table, column, or recorded sequence is missing', async () => {
    expect(await readCulturalInfluenceRows(db, 5, 10)).toBeUndefined();

    await db.schema.dropTable('VictoryProgress').execute();
    expect(await readCulturalInfluenceRows(db, 5, 10)).toBeUndefined();

    await db.schema.createTable('VictoryProgress')
      .addColumn('ID', 'integer', column => column.primaryKey().autoIncrement())
      .addColumn('Key', 'integer', column => column.notNull())
      .addColumn('Turn', 'integer', column => column.notNull())
      .addColumn('CreatedAt', 'integer', column => column.notNull())
      .execute();
    expect(await readCulturalInfluenceRows(db, 5, 10)).toBeUndefined();
  });

  it('should parse every recorded level, trend, ratio, and turning point in both directions', async () => {
    for (let key = 0; key <= 6; key++) await identity(db, key, `Civ${key}`);
    await progress(db, 20, 10, cultural({
      Civ0: {
        Civ1: 'Influential (120%) - Rising (4 turns to Influential, tourism/culture ratio 20%)',
        Civ2: 'Popular (75%) - Falling (tourism/culture ratio -6%)',
        Civ3: 'Familiar (20%) - Static (tourism/culture ratio 0%)',
        Civ4: 'Dominant (200%) - Rising Slowly (tourism/culture ratio 1%)',
        Civ5: 'Exotic (10%) - ',
        Civ6: 'Influential (140%) - Rising (tourism/culture ratio 15%)'
      },
      Civ1: { Civ0: 'Popular (75%) - Rising (tourism/culture ratio 12%)' },
      Civ2: { Civ0: 'Popular (75%) - Accelerating (tourism/culture ratio 3%)' }
    }));

    const rows = await readCulturalInfluenceRows(db, 5, 10);
    const observation = projectCulturalInfluence(rows![0]!, 0, await players(), () => true);
    expect(observation.source).toMatchObject({ table: 'VictoryProgress', id: 20, turn: 10 });
    expect(observation.readings).toEqual([
      {
        otherPlayerID: 1, direction: 'outgoing', level: 'Influential', percentage: 120,
        trend: 'Rising', turnsToInfluential: 4, tourismCultureRatio: 20
      },
      {
        otherPlayerID: 1, direction: 'incoming', level: 'Popular', percentage: 75,
        trend: 'Rising', tourismCultureRatio: 12
      },
      {
        otherPlayerID: 2, direction: 'outgoing', level: 'Popular', percentage: 75,
        trend: 'Falling', tourismCultureRatio: -6
      },
      {
        otherPlayerID: 3, direction: 'outgoing', level: 'Familiar', percentage: 20,
        trend: 'Static', tourismCultureRatio: 0
      },
      {
        otherPlayerID: 4, direction: 'outgoing', level: 'Dominant', percentage: 200,
        trend: 'Rising Slowly', tourismCultureRatio: 1
      },
      { otherPlayerID: 5, direction: 'outgoing', level: 'Exotic', percentage: 10 },
      {
        otherPlayerID: 6, direction: 'outgoing', level: 'Influential', percentage: 140,
        trend: 'Rising', tourismCultureRatio: 15
      }
    ]);
    expect(observation.readings[5]).not.toHaveProperty('trend');
  });

  it('should keep only known, uniquely resolved major labels for the receiver', async () => {
    await identity(db, 0, 'Civ0');
    await identity(db, 1, 'Civ1');
    await identity(db, 2, 'Civ2');
    await identity(db, 3, 'Civ3', 0);
    await identity(db, 4, 'Civ1');
    await progress(db, 30, 10, cultural({
      Civ0: {
        Civ1: 'Popular (60%) - Static (tourism/culture ratio 0%)',
        Civ2: 'Familiar (30%) - Static (tourism/culture ratio 0%)',
        Civ3: 'Exotic (10%) - '
      }
    }));

    const rows = await readCulturalInfluenceRows(db, 5, 10);
    const identities = await players();
    const hidden = projectCulturalInfluence(rows![0]!, 0, identities, () => false);
    expect(hidden.readings).toEqual([]);

    const known = projectCulturalInfluence(rows![0]!, 0, identities, () => true);
    expect(known.readings).toEqual([
      {
        otherPlayerID: 2, direction: 'outgoing', level: 'Familiar', percentage: 30,
        trend: 'Static', tourismCultureRatio: 0
      }
    ]);
  });

  it('should not read any direction when the receiver label is ambiguous', async () => {
    await identity(db, 0, 'Civ0');
    await identity(db, 1, 'Civ1');
    await identity(db, 9, 'Civ0');
    await progress(db, 40, 10, cultural({
      Civ0: { Civ1: 'Popular (60%) - Static (tourism/culture ratio 0%)' }
    }));

    const rows = await readCulturalInfluenceRows(db, 5, 10);
    const observation = projectCulturalInfluence(rows![0]!, 0, await players(), () => true);
    expect(observation.readings).toEqual([]);
  });

  it('should keep a malformed or status row as an empty observation inside the sequence', async () => {
    await identity(db, 0, 'Civ0');
    await identity(db, 1, 'Civ1');
    await progress(db, 50, 5, cultural({
      Civ0: { Civ1: 'Familiar (20%) - Static (tourism/culture ratio 0%)' }
    }));
    await progress(db, 51, 7, cultural({ Civ0: { Civ1: 'Familiar (20%) - Accelerating (x)' } }));
    await progress(db, 52, 9, 'Not available');
    await progress(db, 53, 10, cultural({ Civ0: { Civ1: 'Popular (40%) - Static (tourism/culture ratio 0%)' } }));

    const rows = await readCulturalInfluenceRows(db, 5, 10);
    expect(rows?.map(row => row.ID)).toEqual([50, 51, 52, 53]);
    const identities = await players();
    expect(rows!.map(row => projectCulturalInfluence(row, 0, identities, () => true).readings)).toEqual([
      [{ otherPlayerID: 1, direction: 'outgoing', level: 'Familiar', percentage: 20,
        trend: 'Static', tourismCultureRatio: 0 }],
      [],
      [],
      [{ otherPlayerID: 1, direction: 'outgoing', level: 'Popular', percentage: 40,
        trend: 'Static', tourismCultureRatio: 0 }]
    ]);
  });
});
