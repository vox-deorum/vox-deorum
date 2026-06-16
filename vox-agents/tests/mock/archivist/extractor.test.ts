/**
 * Tests for the archivist extractor: turn-context assembly and per-player episode
 * extraction. Uses a seeded in-memory knowledge SQLite DB (Kysely + better-sqlite3 +
 * ParseJSONResultsPlugin, mirroring openReadonlyGameDb) and a temp telepathist SQLite DB.
 * The missing-telepathist-DB case points at a non-existent path / passes null.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, ParseJSONResultsPlugin } from 'kysely';
import { extractTurnContexts, extractPlayerEpisodes } from '../../../src/archivist/pipeline/extractor.js';
import type { KnowledgeDatabase } from '../../../src/archivist/types.js';

// ---------------------------------------------------------------------------
// In-memory knowledge DB seeding
// ---------------------------------------------------------------------------

/**
 * Create the subset of knowledge tables the extractor reads. JSON columns are
 * stored as TEXT and parsed on read by ParseJSONResultsPlugin, matching how the
 * real read-only opener consumes them.
 */
function createKnowledgeSchema(sqlite: InstanceType<typeof Database>) {
  sqlite.exec(`
    CREATE TABLE PlayerInformations (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Key INTEGER,
      Civilization TEXT,
      Leader TEXT,
      IsMajor INTEGER,
      IsHuman INTEGER,
      TeamID INTEGER,
      Data TEXT
    );
    CREATE TABLE PlayerSummaries (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Key INTEGER,
      Turn INTEGER,
      Score INTEGER,
      Era TEXT,
      Votes INTEGER,
      MajorAlly TEXT,
      Cities INTEGER,
      Population INTEGER,
      GoldPerTurn REAL,
      HappinessPercentage REAL,
      TourismPerTurn REAL,
      CulturePerTurn REAL,
      MilitaryUnits INTEGER,
      MilitarySupply INTEGER,
      MilitaryStrength REAL,
      Technologies INTEGER,
      PolicyBranches TEXT,
      Relationships TEXT
    );
    CREATE TABLE CityInformations (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Key INTEGER,
      Turn INTEGER,
      Owner TEXT,
      MajorityReligion TEXT,
      ProductionPerTurn REAL,
      FoodPerTurn REAL,
      Population INTEGER
    );
    CREATE TABLE VictoryProgress (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Key INTEGER,
      Turn INTEGER,
      DominationVictory TEXT,
      ScienceVictory TEXT,
      CulturalVictory TEXT,
      DiplomaticVictory TEXT
    );
    CREATE TABLE StrategyChanges (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Key INTEGER,
      Turn INTEGER,
      GrandStrategy TEXT
    );
  `);
}

interface SummarySeed {
  Key: number;
  Turn: number;
  Score?: number | null;
  Era?: string | null;
  Votes?: number | null;
  MajorAlly?: string | null;
  Cities?: number | null;
  Population?: number | null;
  GoldPerTurn?: number | null;
  HappinessPercentage?: number | null;
  TourismPerTurn?: number | null;
  CulturePerTurn?: number | null;
  MilitaryUnits?: number | null;
  MilitarySupply?: number | null;
  MilitaryStrength?: number | null;
  Technologies?: number | null;
  PolicyBranches?: Record<string, string[]> | null;
  Relationships?: Record<string, string | string[]> | null;
}

function insertPlayerInfo(
  sqlite: InstanceType<typeof Database>,
  row: { Key: number; Civilization: string; IsMajor: number }
) {
  sqlite
    .prepare(
      `INSERT INTO PlayerInformations (Key, Civilization, Leader, IsMajor, IsHuman, TeamID, Data)
       VALUES (?, ?, ?, ?, 0, ?, '{}')`
    )
    .run(row.Key, row.Civilization, `${row.Civilization}-leader`, row.IsMajor, row.Key);
}

function insertSummary(sqlite: InstanceType<typeof Database>, row: SummarySeed) {
  sqlite
    .prepare(
      `INSERT INTO PlayerSummaries
        (Key, Turn, Score, Era, Votes, MajorAlly, Cities, Population, GoldPerTurn,
         HappinessPercentage, TourismPerTurn, CulturePerTurn, MilitaryUnits,
         MilitarySupply, MilitaryStrength, Technologies, PolicyBranches, Relationships)
       VALUES (@Key, @Turn, @Score, @Era, @Votes, @MajorAlly, @Cities, @Population,
         @GoldPerTurn, @HappinessPercentage, @TourismPerTurn, @CulturePerTurn,
         @MilitaryUnits, @MilitarySupply, @MilitaryStrength, @Technologies,
         @PolicyBranches, @Relationships)`
    )
    .run({
      Key: row.Key,
      Turn: row.Turn,
      Score: row.Score ?? null,
      Era: row.Era ?? null,
      Votes: row.Votes ?? null,
      MajorAlly: row.MajorAlly ?? null,
      Cities: row.Cities ?? null,
      Population: row.Population ?? null,
      GoldPerTurn: row.GoldPerTurn ?? null,
      HappinessPercentage: row.HappinessPercentage ?? null,
      TourismPerTurn: row.TourismPerTurn ?? null,
      CulturePerTurn: row.CulturePerTurn ?? null,
      MilitaryUnits: row.MilitaryUnits ?? null,
      MilitarySupply: row.MilitarySupply ?? null,
      MilitaryStrength: row.MilitaryStrength ?? null,
      Technologies: row.Technologies ?? null,
      PolicyBranches: row.PolicyBranches != null ? JSON.stringify(row.PolicyBranches) : null,
      Relationships: row.Relationships != null ? JSON.stringify(row.Relationships) : null,
    });
}

function insertCity(
  sqlite: InstanceType<typeof Database>,
  row: { Key: number; Turn: number; Owner: string; ProductionPerTurn?: number; FoodPerTurn?: number; MajorityReligion?: string | null }
) {
  sqlite
    .prepare(
      `INSERT INTO CityInformations (Key, Turn, Owner, MajorityReligion, ProductionPerTurn, FoodPerTurn, Population)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.Key,
      row.Turn,
      row.Owner,
      row.MajorityReligion ?? null,
      row.ProductionPerTurn ?? 0,
      row.FoodPerTurn ?? 0,
      10
    );
}

function insertVictory(
  sqlite: InstanceType<typeof Database>,
  row: { Key: number; Turn: number; DominationVictory?: unknown }
) {
  sqlite
    .prepare(
      `INSERT INTO VictoryProgress (Key, Turn, DominationVictory, ScienceVictory, CulturalVictory, DiplomaticVictory)
       VALUES (?, ?, ?, 'unavailable', 'unavailable', 'unavailable')`
    )
    .run(
      row.Key,
      row.Turn,
      row.DominationVictory != null ? JSON.stringify(row.DominationVictory) : 'unavailable'
    );
}

function insertStrategy(
  sqlite: InstanceType<typeof Database>,
  row: { Key: number; Turn: number; GrandStrategy: string | null }
) {
  sqlite
    .prepare(`INSERT INTO StrategyChanges (Key, Turn, GrandStrategy) VALUES (?, ?, ?)`)
    .run(row.Key, row.Turn, row.GrandStrategy);
}

function makeKysely(sqlite: InstanceType<typeof Database>): Kysely<KnowledgeDatabase> {
  return new Kysely<KnowledgeDatabase>({
    dialect: new SqliteDialect({ database: sqlite }),
    plugins: [new ParseJSONResultsPlugin()],
  });
}

// ---------------------------------------------------------------------------
// Telepathist DB seeding
// ---------------------------------------------------------------------------

function createTelepathistDb(
  dbPath: string,
  rows: Array<{ turn: number; situationAbstract: string; decisionAbstract: string; situation: string; decisions: string }>
) {
  const sqlite = new Database(dbPath);
  sqlite.exec(`
    CREATE TABLE turn_summaries (
      turn INTEGER PRIMARY KEY,
      situation TEXT,
      situationAbstract TEXT,
      decisions TEXT,
      decisionAbstract TEXT,
      narrative TEXT,
      model TEXT,
      createdAt INTEGER
    );
  `);
  const stmt = sqlite.prepare(
    `INSERT INTO turn_summaries (turn, situation, situationAbstract, decisions, decisionAbstract, narrative, model, createdAt)
     VALUES (?, ?, ?, ?, ?, '', 'test-model', 0)`
  );
  for (const r of rows) {
    stmt.run(r.turn, r.situation, r.situationAbstract, r.decisions, r.decisionAbstract);
  }
  sqlite.close();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractor', () => {
  let sqlite: InstanceType<typeof Database>;
  let db: Kysely<KnowledgeDatabase>;
  let tmpDir: string;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    createKnowledgeSchema(sqlite);
    db = makeKysely(sqlite);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivist-extractor-'));
  });

  afterEach(async () => {
    await db.destroy(); // also closes the underlying better-sqlite3 handle
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('extractTurnContexts', () => {
    it('should keep the LATEST row per (Key, Turn) for player summaries', async () => {
      insertPlayerInfo(sqlite, { Key: 0, Civilization: 'Rome', IsMajor: 1 });
      // Two versions of (Key=0, Turn=10); the latest (highest ID) Score should win.
      insertSummary(sqlite, { Key: 0, Turn: 10, Score: 100, Era: 'Ancient Era' });
      insertSummary(sqlite, { Key: 0, Turn: 10, Score: 250, Era: 'Classical Era' });

      const contexts = await extractTurnContexts(db);
      const ctx = contexts.get(10)!;
      expect(ctx).toBeDefined();
      const summary = ctx.playerSummaries.get(0)!;
      expect(summary.Score).toBe(250);
      expect(summary.Era).toBe('Classical Era');
    });

    it('should assemble player, city, and victory context keyed by turn', async () => {
      insertPlayerInfo(sqlite, { Key: 0, Civilization: 'Rome', IsMajor: 1 });
      insertPlayerInfo(sqlite, { Key: 1, Civilization: 'Egypt', IsMajor: 1 });
      insertSummary(sqlite, { Key: 0, Turn: 5, Score: 50 });
      insertSummary(sqlite, { Key: 1, Turn: 5, Score: 60 });
      insertCity(sqlite, { Key: 100, Turn: 5, Owner: 'Rome', ProductionPerTurn: 7, FoodPerTurn: 9 });
      insertCity(sqlite, { Key: 101, Turn: 5, Owner: 'Egypt', ProductionPerTurn: 3, FoodPerTurn: 4 });
      // Victory: Key=0 global is kept; a Key=1 row must be ignored.
      insertVictory(sqlite, { Key: 0, Turn: 5, DominationVictory: { Rome: { CapitalsPercentage: 40 }, Contender: 'Rome' } });
      insertVictory(sqlite, { Key: 1, Turn: 5 });

      const contexts = await extractTurnContexts(db);
      expect(contexts.size).toBe(1);
      const ctx = contexts.get(5)!;
      expect(ctx.playerSummaries.size).toBe(2);
      expect(ctx.cityInformations).toHaveLength(2);
      expect(ctx.victoryProgress).not.toBeNull();
      // playerInfos shared across turns; both majors present.
      expect(ctx.playerInfos.get(0)!.Civilization).toBe('Rome');
      expect(ctx.playerInfos.size).toBe(2);
    });

    it('should only build contexts for turns that have player summaries', async () => {
      insertPlayerInfo(sqlite, { Key: 0, Civilization: 'Rome', IsMajor: 1 });
      insertSummary(sqlite, { Key: 0, Turn: 1, Score: 10 });
      insertSummary(sqlite, { Key: 0, Turn: 2, Score: 20 });
      // A stray city on turn 99 with no summaries must NOT create a turn context.
      insertCity(sqlite, { Key: 5, Turn: 99, Owner: 'Rome' });

      const contexts = await extractTurnContexts(db);
      expect([...contexts.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    });

    it('should default missing city/victory context to empty/null', async () => {
      insertPlayerInfo(sqlite, { Key: 0, Civilization: 'Rome', IsMajor: 1 });
      insertSummary(sqlite, { Key: 0, Turn: 3, Score: 10 });

      const ctx = (await extractTurnContexts(db)).get(3)!;
      expect(ctx.cityInformations).toEqual([]);
      expect(ctx.victoryProgress).toBeNull();
    });
  });

  describe('extractPlayerEpisodes', () => {
    /** Seed a 2-turn, 2-major game and return its turn contexts. */
    async function seedTwoTurnGame() {
      insertPlayerInfo(sqlite, { Key: 0, Civilization: 'Rome', IsMajor: 1 });
      insertPlayerInfo(sqlite, { Key: 1, Civilization: 'Egypt', IsMajor: 1 });
      insertPlayerInfo(sqlite, { Key: 9, Civilization: 'Venice', IsMajor: 0 }); // minor

      // Turn 10 — Rome at war with Egypt, allied with minor Venice.
      insertSummary(sqlite, {
        Key: 0, Turn: 10, Score: 100, Era: 'Medieval Era', Cities: 3, Population: 50,
        Technologies: 12, GoldPerTurn: 15, MilitaryUnits: 8, MilitarySupply: 10,
        PolicyBranches: { Tradition: ['a', 'b'], Liberty: ['c'] },
        Relationships: { Egypt: ['War (Our War Weariness: 25%)'] },
      });
      insertSummary(sqlite, { Key: 1, Turn: 10, Score: 90, Era: 'Medieval Era' });
      insertSummary(sqlite, { Key: 9, Turn: 10, MajorAlly: 'Rome' });

      // Turn 20 — Rome only (Egypt eliminated, etc.).
      insertSummary(sqlite, { Key: 0, Turn: 20, Score: 200, Era: 'Renaissance Era', Cities: 4 });

      insertCity(sqlite, { Key: 100, Turn: 10, Owner: 'Rome', ProductionPerTurn: 5, FoodPerTurn: 6 });
      insertCity(sqlite, { Key: 101, Turn: 10, Owner: 'Rome', ProductionPerTurn: 4, FoodPerTurn: 3 });
      insertCity(sqlite, { Key: 102, Turn: 10, Owner: 'Egypt', ProductionPerTurn: 99, FoodPerTurn: 99 });

      insertVictory(sqlite, {
        Key: 0, Turn: 10,
        DominationVictory: { Rome: { CapitalsPercentage: 30 }, Contender: 'Egypt', Egypt: { CapitalsPercentage: 55 } },
      });

      insertStrategy(sqlite, { Key: 0, Turn: 8, GrandStrategy: 'Conquest' });

      return extractTurnContexts(db);
    }

    it('should merge telepathist summaries and compute diplomacy/victory/basic fields', async () => {
      const contexts = await seedTwoTurnGame();
      const telPath = path.join(tmpDir, 'rome.db');
      createTelepathistDb(telPath, [
        { turn: 10, situationAbstract: 'sit-abs', decisionAbstract: 'dec-abs', situation: 'sit', decisions: 'dec' },
      ]);

      const episodes = await extractPlayerEpisodes(db, telPath, 0, 'Rome', contexts, 'game-x', 0);

      const t10 = episodes.find((e) => e.turn === 10)!;
      expect(t10).toBeDefined();
      // Identity & winner flag (victoryPlayerId = 0).
      expect(t10.gameId).toBe('game-x');
      expect(t10.isWinner).toBe(true);
      expect(t10.civilization).toBe('Rome');
      // Basic state.
      expect(t10.era).toBe('Medieval Era');
      expect(t10.grandStrategy).toBe('Conquest'); // latest at/before turn 10
      expect(t10.score).toBe(100);
      // Diplomacy: at war with major Egypt, weariness parsed.
      expect(t10.activeWars).toBe(1);
      expect(t10.warWeariness).toBe(25);
      // City aggregates: only Rome-owned cities summed (5+4, 6+3).
      expect(t10.productionPerTurn).toBe(9);
      expect(t10.foodPerTurn).toBe(9);
      // Policies: 2 + 1 individual policies.
      expect(t10.policies).toBe(3);
      // Minor allies: Venice's MajorAlly = Rome.
      expect(t10.minorAllies).toBe(1);
      // Victory progress (player + leader/contender).
      expect(t10.dominationProgress).toBe(30);
      expect(t10.dominationLeaderProgress).toBe(55);
      // Telepathist text merged.
      expect(t10.situationAbstract).toBe('sit-abs');
      expect(t10.decisionAbstract).toBe('dec-abs');
      expect(t10.situation).toBe('sit');
      expect(t10.decisions).toBe('dec');
    });

    it('should leave telepathist text null for turns without a summary row', async () => {
      const contexts = await seedTwoTurnGame();
      const telPath = path.join(tmpDir, 'rome.db');
      createTelepathistDb(telPath, [
        { turn: 10, situationAbstract: 'x', decisionAbstract: 'y', situation: 's', decisions: 'd' },
      ]);

      const episodes = await extractPlayerEpisodes(db, telPath, 0, 'Rome', contexts, 'game-x', -1);
      const t20 = episodes.find((e) => e.turn === 20)!;
      expect(t20).toBeDefined();
      expect(t20.situationAbstract).toBeNull();
      expect(t20.decisions).toBeNull();
      expect(t20.isWinner).toBe(false); // victoryPlayerId = -1
    });

    it('should skip turns where the player has no summary', async () => {
      const contexts = await seedTwoTurnGame();
      // Player 1 (Egypt) only present on turn 10.
      const episodes = await extractPlayerEpisodes(db, null, 1, 'Egypt', contexts, 'game-x', -1);
      expect(episodes.map((e) => e.turn)).toEqual([10]);
    });

    it('should honor agentTurns by emitting episodes only for those turns', async () => {
      const contexts = await seedTwoTurnGame();
      const onlyTurn20 = new Set<number>([20]);
      const episodes = await extractPlayerEpisodes(db, null, 0, 'Rome', contexts, 'game-x', -1, onlyTurn20);
      expect(episodes.map((e) => e.turn)).toEqual([20]);
    });

    it('should treat an empty agentTurns set as eligible-for-nothing', async () => {
      const contexts = await seedTwoTurnGame();
      const episodes = await extractPlayerEpisodes(db, null, 0, 'Rome', contexts, 'game-x', -1, new Set());
      expect(episodes).toHaveLength(0);
    });

    it('should still produce episodes when the telepathist DB is missing (non-existent path)', async () => {
      const contexts = await seedTwoTurnGame();
      const missingPath = path.join(tmpDir, 'does-not-exist.db');
      expect(fs.existsSync(missingPath)).toBe(false);

      const episodes = await extractPlayerEpisodes(db, missingPath, 0, 'Rome', contexts, 'game-x', 0);
      expect(episodes.length).toBeGreaterThan(0);
      const t10 = episodes.find((e) => e.turn === 10)!;
      // Game-knowledge fields still computed; telepathist text gracefully null.
      expect(t10.score).toBe(100);
      expect(t10.situationAbstract).toBeNull();
      expect(t10.situation).toBeNull();
    });

    it('should produce episodes with null telepathist text when telepathistDbPath is null', async () => {
      const contexts = await seedTwoTurnGame();
      const episodes = await extractPlayerEpisodes(db, null, 0, 'Rome', contexts, 'game-x', 0);
      const t10 = episodes.find((e) => e.turn === 10)!;
      expect(t10.situationAbstract).toBeNull();
      expect(t10.decisionAbstract).toBeNull();
    });
  });
});
