import Database from 'better-sqlite3';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';
import type { KnowledgeDatabase } from '../../../mcp-server/dist/knowledge/schema/base.js';
import { setupKnowledgeDatabase } from '../../../mcp-server/dist/knowledge/schema/setup.js';
import { editionBriefRule, editionBriefTemplate } from './newspaper-briefs.js';

/** Small SQLite recording with JSON fields and stable row identities for replay boundary tests. */
export async function createReplayRecording(speed: string | null = 'Epic', briefTurns: readonly number[] = []) {
  const directory = await mkdtemp(path.join(tmpdir(), 'vd-replay-'));
  const filename = path.join(directory, 'recording.db');
  const sqlite = new Database(filename);
  const db = new Kysely<KnowledgeDatabase>({ dialect: new SqliteDialect({ database: sqlite }) });
  await setupKnowledgeDatabase(db);
  sqlite.exec(`
    INSERT INTO PlayerInformations (Key, TeamID, IsMajor, Civilization, Leader, IsHuman)
      VALUES (0, 0, 1, 'Civ0', 'Leader0', 0), (1, 1, 1, 'Civ1', 'Leader1', 0);
  `);
  await db.insertInto('CityInformations').values({
    ID: 21, Key: 42, Turn: 10, CreatedAt: 3010, Player0: 1, Payload: '{}',
    Owner: 'Civ1', Name: 'Port', X: 0, Y: 4, Population: 0, Wonders: '["Beacon"]',
    DefenseStrength: 10, HitPoints: 0, MaxHitPoints: 100, IsCapital: 0, IsPuppet: 0, IsOccupied: 0, IsCoastal: 0,
    FoodStored: 0, FoodPerTurn: 0, ProductionStored: 0, ProductionPerTurn: 0, ProductionTurnsLeft: 0,
    GoldPerTurn: 0, SciencePerTurn: 0, CulturePerTurn: 0, FaithPerTurn: 0, TourismPerTurn: 0,
    HappinessDelta: 0, RazingTurns: 0, ResistanceTurns: 0, BuildingCount: 0, ImportantBuildings: '[]', GreatWorkCount: 0
  } as any).execute();
  if (speed !== null) sqlite.prepare('INSERT INTO GameMetadata VALUES (?, ?)').run('gameSpeed', speed);
  const insert = sqlite.prepare(`INSERT INTO PlayerSummaries (
    ID, Key, Turn, CreatedAt, Player0, Gold, CulturePerTurn, Era, FoundedReligion,
    Resources, DiplomatPoints, OutgoingTradeRoutes, PolicyBranches, Payload, Cities, Population, GoldPerTurn, Technologies
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 1, 1, 0, 0)`);
  for (const [id, turn, gold] of [[1, 5, 1], [2, 10, 10], [3, 10, 20], [4, 20, 10000]]) {
    insert.run(id, 0, turn, 1000 + turn, 2, gold, 5, 'Classical', null, '{}', '{"Player1":200}',
      '{"Home => Port (Civ1)":{"FromGold":0,"ToFood":-1}}', '{"Tradition":["A","B"]}');
  }
  insert.run(5, 5, 0, 1000, 0, 999, 999, null, null, '{}', '{}', '{}', '{}');
  insert.run(6, 1, 5, 1005, 1, 999, 9, 'Classical', null, '{}', '{}', '{}', '{}');
  const event = sqlite.prepare('INSERT INTO GameEvents (ID, Turn, CreatedAt, Player0, Type, Payload) VALUES (?, ?, ?, ?, ?, ?)');
  event.run(101, 6, 2006, 1, 'DeclareWar', '{"OriginatingPlayerID":1,"TargetTeamID":0,"IsAggressor":false}');
  event.run(102, 10, 2010, 1, 'TeamSetHasTech', '{"TeamID":0,"TechID":0,"HasTech":false}');
  event.run(103, 11, 2011, 1, 'PlayerAdoptPolicy', '{"PlayerID":0,"PolicyID":7}');
  addReplayBriefs(sqlite, briefTurns);
  const schema = sqlite.prepare('SELECT sql FROM sqlite_master ORDER BY name').all();
  await db.destroy();
  return {
    filename, schema, originalBytes: await readFile(filename),
    /** Remove the fixture after caller-owned read connections have closed. */
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

/** Record four unrelated, low-priority briefs so an article under test can fill a five-slot front. */
export function addReplayBriefs(sqlite: Database.Database, turns: readonly number[]): void {
  const insert = sqlite.prepare('INSERT INTO GameEvents (ID, Turn, CreatedAt, Player0, Type, Payload) VALUES (?, ?, ?, ?, ?, ?)');
  for (const turn of turns) {
    for (let index = 0; index < 4; index++) {
      const id = 90_000 + 4 * turn + index;
      insert.run(id, turn, id, 1, 'PlayerAdoptPolicyBranch',
        JSON.stringify({ PlayerID: 0, BranchType: `Fixture brief ${id}` }));
    }
  }
}

/** Supply a turn window that crosses same-turn versions and includes structured evidence. */
export function replaySettings(databasePath: string) {
  return { databasePath, receiverPlayerID: 0, fromTurn: 10, toTurn: 18, publicationInterval: 5, comparisonTurns: 5 };
}

/** Author a test article for the permitted turn-six event in the recording. */
export async function writeReplayPublicationCatalogue(databasePath: string) {
  const directory = path.join(path.dirname(databasePath), 'publication-catalogue');
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, 'triggers.json'), JSON.stringify([{
      id: 'fixture-war-report', subject: 'event', tier: 'crisis', event: 'DeclareWar', when: 'event.type === "DeclareWar"',
      values: { eventTurn: 'event.turn' }, tags: ['military'],
      adjust: '10',
    }, editionBriefRule])),
    writeFile(path.join(directory, 'templates.json'), JSON.stringify([{
      id: 'fixture-war-article', triggers: ['fixture-war-report'], tags: ['military'], weight: { base: 1 },
      variants: [{ id: 'notice', headline: 'War declared', body: ['The declaration came on turn {{eventTurn}}.'], weight: { base: 1 } }],
    }, editionBriefTemplate])),
  ]);
  return directory;
}
