import Database from 'better-sqlite3';
import { Kysely, ParseJSONResultsPlugin, SqliteDialect } from 'kysely';
import type { KnowledgeDatabase } from '../../src/knowledge/schema/base.js';
import { setupKnowledgeDatabase } from '../../src/knowledge/schema/setup.js';
import { JsonSerializePlugin } from '../../src/database/helpers/json-serialize-plugin.js';

/** Open a tiny recording with production schema and JSON codecs, owned by the test. */
export async function createEvidenceDatabase(filename = ':memory:') {
  const db = new Kysely<KnowledgeDatabase>({
    dialect: new SqliteDialect({ database: new Database(filename) }),
    plugins: [new JsonSerializePlugin(), new ParseJSONResultsPlugin()]
  });
  await setupKnowledgeDatabase(db);
  return db;
}

/** Open an existing recording read-only with the offline JSON decoder and no setup calls. */
export function openEvidenceRecording(filename: string) {
  return new Kysely<KnowledgeDatabase>({
    dialect: new SqliteDialect({ database: new Database(filename, { readonly: true, fileMustExist: true }) }),
    plugins: [new ParseJSONResultsPlugin()]
  });
}

/** Insert a national version with explicit insertion order, turn, and receiver access. */
export async function summary(db: Kysely<KnowledgeDatabase>, id: number, key: number, turn: number, level: number, values: Record<string, unknown> = {}) {
  await db.insertInto('PlayerSummaries').values({
    ID: id, Key: key, Turn: turn, Version: id, IsLatest: 0,
    CreatedAt: 1000 + turn, Player0: level, Payload: {}, Changes: [],
    Cities: 1, Population: 1, Gold: 0, GoldPerTurn: 0, Technologies: 0, ...values
  } as any).execute();
}

/** Insert an event with a stable source timestamp and explicit row access. */
export async function event(db: Kysely<KnowledgeDatabase>, id: number, turn: number, type: string, payload: Record<string, unknown>, level = 1) {
  await db.insertInto('GameEvents').values({ ID: id, Turn: turn, Type: type, Payload: payload, Player0: level, CreatedAt: 2000 + turn } as any).execute();
}

/** Insert a dated observation of the seeded city 42, with explicit insertion order, turn and access. */
export async function city(db: Kysely<KnowledgeDatabase>, id: number, turn: number, values: Record<string, unknown> = {}) {
  await db.insertInto('CityInformations').values({
    ID: id, Key: 42, Turn: turn, Version: id, IsLatest: 0, CreatedAt: 3000 + turn, Payload: {}, Changes: [],
    Player0: 1, Owner: 'Civ1', Name: 'Port', X: 0, Y: 4, Population: 1, MajorityReligion: null,
    DefenseStrength: 10, HitPoints: 100, MaxHitPoints: 100, IsPuppet: 0, IsCapital: 0, IsOccupied: 0, IsCoastal: 0,
    FoodStored: 0, FoodPerTurn: 0, ProductionStored: 0, ProductionPerTurn: 0, GoldPerTurn: 0,
    SciencePerTurn: 0, CulturePerTurn: 0, FaithPerTurn: 0, TourismPerTurn: 0, HappinessDelta: 0,
    RazingTurns: 0, ResistanceTurns: 0, BuildingCount: 0, Wonders: [], ImportantBuildings: [],
    GreatWorkCount: 0, ProductionTurnsLeft: 0, ...values
  } as any).execute();
}

/** Seed own domestic and trade facts, public culture, basic cities, and dated public conditions. */
export async function seedEvidence(db: Kysely<KnowledgeDatabase>) {
  for (const key of [0, 1, 2, 3]) {
    await db.insertInto('PlayerInformations').values({
      Key: key, TeamID: key, Civilization: `Civ${key}`, Leader: `Leader${key}`, IsMajor: 1, IsHuman: 0, Data: {}
    } as any).execute();
  }
  await summary(db, 1, 0, 5, 2, { Gold: 1, CulturePerTurn: 2, Resources: { Iron: '0 / 2' } });
  await summary(db, 2, 1, 5, 1, { CulturePerTurn: 4, TourismPerTurn: 0, Gold: 999, PolicyBranches: { Tradition: ['A', 'B'] } });
  await summary(db, 3, 2, 5, 0, { CulturePerTurn: 999 });
  await summary(db, 4, 0, 10, 2, { Gold: 10, CulturePerTurn: 5, Era: 'Classical', FoundedReligion: null,
    Resources: { Iron: '0 / 2' }, DiplomatPoints: { Player1: 200 },
    OutgoingTradeRoutes: { 'Home => Port (Civ1)': { FromGold: 0, ToFood: -1 } } });
  await summary(db, 5, 0, 10, 2, { Gold: 20, CulturePerTurn: 5, Era: 'Classical', FoundedReligion: null,
    Resources: { Iron: '0 / 2' }, DiplomatPoints: { Player1: 200 },
    OutgoingTradeRoutes: { 'Home => Port (Civ1)': { FromGold: 0, ToFood: -1 } } });
  await summary(db, 6, 1, 10, 1, { CulturePerTurn: 9, TourismPerTurn: 0, Gold: 999,
    PolicyBranches: { Tradition: ['A', 'B'] }, MajorityReligion: null });
  await summary(db, 7, 0, 20, 2, { Gold: 10000, Era: 'Future', Resources: { Uranium: '1 / 1' }, IsLatest: 1 });
  await db.insertInto('CityInformations').values({
    ID: 21, Key: 42, Turn: 10, Version: 1, IsLatest: 1, CreatedAt: 3010, Payload: {}, Changes: [],
    Player0: 1, Owner: 'Civ1', Name: 'Port', X: 0, Y: 4, Population: 0, MajorityReligion: null,
    DefenseStrength: 10, HitPoints: 0, MaxHitPoints: 100, IsPuppet: 0, IsCapital: 1, IsOccupied: 0, IsCoastal: 0,
    FoodStored: 0, FoodPerTurn: 999, ProductionStored: 0, ProductionPerTurn: 0, GoldPerTurn: 0,
    SciencePerTurn: 0, CulturePerTurn: 0, FaithPerTurn: 0, TourismPerTurn: 0, HappinessDelta: 0,
    RazingTurns: 0, ResistanceTurns: 0, BuildingCount: 0, Wonders: ['Beacon'], ImportantBuildings: [],
    GreatWorkCount: 0, ProductionTurnsLeft: 0
  } as any).execute();
  await event(db, 101, 5, 'TeamSetEra', { TeamID: 0, NewEra: 1 });
  await event(db, 102, 6, 'DeclareWar', { OriginatingPlayerID: 1, TargetTeamID: 0, IsAggressor: false });
  await event(db, 103, 10, 'TeamSetHasTech', { TeamID: 0, TechID: 0, HasTech: false });
  await event(db, 104, 11, 'PlayerAdoptPolicy', { PlayerID: 0, PolicyID: 7 });
  await event(db, 105, 9, 'PlayerAdoptPolicy', { PlayerID: 0, PolicyID: 8 }, 0);
  await event(db, 106, 10, 'ReligionFounded', { PlayerID: 0, ReligionID: 2, HolyCityID: 42 });
}
