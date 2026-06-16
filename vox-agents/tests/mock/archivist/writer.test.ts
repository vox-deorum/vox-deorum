/**
 * Tests for the archivist EpisodeWriter against a REAL DuckDB on a temp file.
 * Exercises schema creation, the appender round-trip (including REAL[] list/vector
 * columns), game-outcome upsert, processed-player / processed-turn / landmark
 * queries, text+embedding updates, and the delete/reset helpers.
 *
 * Structural assertions only: rows present, counts, set membership, round-trip
 * fidelity. No logger text or full-object snapshots.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { EpisodeWriter } from '../../../src/archivist/pipeline/writer.js';
import { getEpisodeDbConnection } from '../../../src/archivist/episode-db.js';
import type { Episode } from '../../../src/archivist/types.js';

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

/** Build a fully-populated Episode with neutral defaults, overridable per test. */
function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    // Identity
    gameId: 'game-a',
    turn: 100,
    playerId: 0,
    civilization: 'Rome',
    isWinner: false,
    // Basic state
    era: 'Medieval Era',
    grandStrategy: null,
    // Diplomatic counts
    isVassal: 0,
    activeWars: 0,
    truces: 0,
    defensivePacts: 0,
    friends: 0,
    denouncements: 0,
    vassals: 0,
    warWeariness: 0,
    // Raw values
    score: 100,
    cities: 3,
    population: 30,
    goldPerTurn: 20,
    culturePerTurn: 10,
    tourismPerTurn: 5,
    militaryStrength: 100,
    technologies: 10,
    votes: 2,
    happinessPercentage: 50,
    productionPerTurn: 30,
    foodPerTurn: 40,
    policies: 5,
    minorAllies: 1,
    militaryUnits: 8,
    militarySupply: 10,
    // Victory progress
    dominationProgress: null,
    scienceProgress: null,
    cultureProgress: null,
    diplomaticProgress: null,
    dominationLeaderProgress: null,
    scienceLeaderProgress: null,
    cultureLeaderProgress: null,
    diplomaticLeaderProgress: null,
    // Text
    situationAbstract: null,
    decisionAbstract: null,
    situation: null,
    decisions: null,
    // Computed shares
    tourismShare: null,
    militaryShare: null,
    citiesShare: null,
    populationShare: null,
    votesShare: null,
    minorAlliesShare: null,
    // Per-pop
    sciencePerPop: null,
    faithPerPop: null,
    productionPerPop: null,
    foodPerPop: null,
    culturePerPop: null,
    goldPerPop: null,
    // Gaps + derived
    technologiesGap: 0,
    policiesGap: 0,
    supplyUtilization: null,
    religionPercentage: 0,
    ideologyAllies: 0,
    ideologyShare: 0,
    // Vectors
    gameStateVector: [0.1, 0.2, 0.3],
    neighborVector: [0.4, 0.5],
    situationAbstractEmbedding: null,
    // Flag
    isLandmark: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Per-test temp DB lifecycle
// ---------------------------------------------------------------------------

let tempDir: string;
let dbPath: string;
let writer: EpisodeWriter;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'archivist-writer-'));
  dbPath = join(tempDir, 'episodes.duckdb');
  writer = await EpisodeWriter.create(dbPath);
});

afterEach(async () => {
  await writer.close();
  // The native DuckDB instance is held in fromCache(), so the OS file handle may
  // linger briefly on Windows. Best-effort removal; the OS temp dir is reclaimed
  // regardless and each test uses a unique path.
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore EBUSY on locked DuckDB file */
  }
});

// ---------------------------------------------------------------------------
// Helper: query raw rows back via a direct DuckDB connection
// ---------------------------------------------------------------------------

/** DuckDB returns LIST columns as DuckDBListValue ({ items }); unwrap to plain arrays. */
function normalize(value: any): any {
  if (value && typeof value === 'object' && Array.isArray((value as any).items)) {
    return (value as any).items;
  }
  return value;
}

async function queryAll(sql: string): Promise<Record<string, any>[]> {
  const conn = await getEpisodeDbConnection(dbPath);
  try {
    const reader = await conn.runAndReadAll(sql);
    const rows = reader.getRowObjects() as Record<string, any>[];
    return rows.map(row => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) out[k] = normalize(v);
      return out;
    });
  } finally {
    conn.disconnectSync();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EpisodeWriter', () => {
  describe('schema creation', () => {
    it('should create the episodes and game_outcomes tables', async () => {
      const tables = await queryAll(
        "SELECT table_name FROM information_schema.tables WHERE table_name IN ('episodes', 'game_outcomes') ORDER BY table_name"
      );
      expect(tables.map(t => t.table_name)).toEqual(['episodes', 'game_outcomes']);
    });
  });

  describe('writeEpisodes (appender round-trip)', () => {
    it('should be a no-op for an empty array', async () => {
      await writer.writeEpisodes([]);
      const rows = await queryAll('SELECT COUNT(*)::INTEGER AS n FROM episodes');
      expect(rows[0].n).toBe(0);
    });

    it('should round-trip identity, scalar, and flag fields', async () => {
      await writer.writeEpisodes([
        makeEpisode({ gameId: 'g1', turn: 5, playerId: 2, civilization: 'Egypt', isWinner: true, score: 77, era: 'Ancient Era', isLandmark: true }),
      ]);
      const rows = await queryAll(
        "SELECT game_id, turn, player_id, civilization, is_winner, score, era, is_landmark FROM episodes"
      );
      expect(rows).toHaveLength(1);
      const r = rows[0];
      expect(r.game_id).toBe('g1');
      expect(Number(r.turn)).toBe(5);
      expect(Number(r.player_id)).toBe(2);
      expect(r.civilization).toBe('Egypt');
      expect(r.is_winner).toBe(true);
      expect(Number(r.score)).toBe(77);
      expect(r.era).toBe('Ancient Era');
      expect(r.is_landmark).toBe(true);
    });

    it('should round-trip REAL[] vector and embedding columns', async () => {
      await writer.writeEpisodes([
        makeEpisode({
          gameId: 'g1',
          turn: 1,
          playerId: 0,
          gameStateVector: [1.5, -2.5, 3.25],
          neighborVector: [0.5, 0.25],
          situationAbstractEmbedding: [0.1, 0.2, 0.3, 0.4],
        }),
      ]);
      const rows = await queryAll(
        'SELECT game_state_vector, neighbor_vector, situation_abstract_embedding FROM episodes'
      );
      expect(rows).toHaveLength(1);
      const gs = (rows[0].game_state_vector as number[]).map(Number);
      const nb = (rows[0].neighbor_vector as number[]).map(Number);
      const emb = (rows[0].situation_abstract_embedding as number[]).map(Number);
      expect(gs).toHaveLength(3);
      gs.forEach((v, i) => expect(v).toBeCloseTo([1.5, -2.5, 3.25][i], 4));
      expect(nb.map(v => Number(v.toFixed(4)))).toEqual([0.5, 0.25]);
      expect(emb).toHaveLength(4);
      emb.forEach((v, i) => expect(v).toBeCloseTo([0.1, 0.2, 0.3, 0.4][i], 4));
    });

    it('should store null for null embedding and null grand strategy', async () => {
      await writer.writeEpisodes([
        makeEpisode({ grandStrategy: null, situationAbstractEmbedding: null }),
      ]);
      const rows = await queryAll(
        'SELECT grand_strategy, situation_abstract_embedding FROM episodes'
      );
      expect(rows[0].grand_strategy).toBeNull();
      expect(rows[0].situation_abstract_embedding).toBeNull();
    });

    it('should insert multiple episodes preserving distinct primary keys', async () => {
      await writer.writeEpisodes([
        makeEpisode({ gameId: 'g1', turn: 1, playerId: 0 }),
        makeEpisode({ gameId: 'g1', turn: 1, playerId: 1 }),
        makeEpisode({ gameId: 'g1', turn: 2, playerId: 0 }),
      ]);
      const rows = await queryAll('SELECT COUNT(*)::INTEGER AS n FROM episodes');
      expect(rows[0].n).toBe(3);
    });
  });

  describe('writeGameOutcome (upsert)', () => {
    it('should insert a new outcome row', async () => {
      await writer.writeGameOutcome('g1', 3, 'DOMINATION', 250);
      const rows = await queryAll('SELECT * FROM game_outcomes');
      expect(rows).toHaveLength(1);
      expect(rows[0].game_id).toBe('g1');
      expect(Number(rows[0].winner_player_id)).toBe(3);
      expect(rows[0].victory_type).toBe('DOMINATION');
      expect(Number(rows[0].max_turn)).toBe(250);
    });

    it('should update an existing outcome on conflict, not duplicate', async () => {
      await writer.writeGameOutcome('g1', 3, 'DOMINATION', 250);
      await writer.writeGameOutcome('g1', 5, null, 300);
      const rows = await queryAll('SELECT * FROM game_outcomes');
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].winner_player_id)).toBe(5);
      expect(rows[0].victory_type).toBeNull();
      expect(Number(rows[0].max_turn)).toBe(300);
    });
  });

  describe('getProcessedPlayers', () => {
    it('should return the distinct player ids for a game', async () => {
      await writer.writeEpisodes([
        makeEpisode({ gameId: 'g1', turn: 1, playerId: 0 }),
        makeEpisode({ gameId: 'g1', turn: 2, playerId: 0 }),
        makeEpisode({ gameId: 'g1', turn: 1, playerId: 4 }),
        makeEpisode({ gameId: 'g2', turn: 1, playerId: 9 }),
      ]);
      const players = await writer.getProcessedPlayers('g1');
      expect(players).toEqual(new Set([0, 4]));
    });

    it('should return an empty set for an unknown game', async () => {
      expect(await writer.getProcessedPlayers('nope')).toEqual(new Set());
    });
  });

  describe('getPlayerTurns', () => {
    it('should return all turn numbers for a player in a game', async () => {
      await writer.writeEpisodes([
        makeEpisode({ gameId: 'g1', turn: 1, playerId: 0 }),
        makeEpisode({ gameId: 'g1', turn: 3, playerId: 0 }),
        makeEpisode({ gameId: 'g1', turn: 2, playerId: 1 }),
      ]);
      expect(await writer.getPlayerTurns('g1', 0)).toEqual(new Set([1, 3]));
      expect(await writer.getPlayerTurns('g1', 1)).toEqual(new Set([2]));
    });
  });

  describe('landmark queries and marking', () => {
    beforeEach(async () => {
      await writer.writeEpisodes([
        makeEpisode({ gameId: 'g1', turn: 1, playerId: 0 }),
        makeEpisode({ gameId: 'g1', turn: 2, playerId: 0 }),
        makeEpisode({ gameId: 'g1', turn: 3, playerId: 0, situationAbstractEmbedding: [0.1, 0.2] }),
        makeEpisode({ gameId: 'g1', turn: 1, playerId: 1 }),
      ]);
    });

    it('should mark the requested (turn, playerId) keys as landmarks', async () => {
      await writer.markLandmarks('g1', [
        { turn: 1, playerId: 0 },
        { turn: 3, playerId: 0 },
      ]);
      expect(await writer.getLandmarkTurns('g1', 0)).toEqual([1, 3]);
      expect(await writer.getLandmarkTurns('g1', 1)).toEqual([]);
    });

    it('should report only embedded landmark turns', async () => {
      await writer.markLandmarks('g1', [
        { turn: 1, playerId: 0 },
        { turn: 3, playerId: 0 },
      ]);
      // turn 1 has no embedding; turn 3 does
      expect(await writer.getEmbeddedLandmarkTurns('g1', 0)).toEqual(new Set([3]));
    });

    it('should unmark a single landmark', async () => {
      await writer.markLandmarks('g1', [
        { turn: 1, playerId: 0 },
        { turn: 2, playerId: 0 },
      ]);
      await writer.unmarkLandmark('g1', 0, 1);
      expect(await writer.getLandmarkTurns('g1', 0)).toEqual([2]);
    });

    it('should reset all landmark flags for a game', async () => {
      await writer.markLandmarks('g1', [{ turn: 1, playerId: 0 }, { turn: 1, playerId: 1 }]);
      await writer.resetGameLandmarks('g1');
      expect(await writer.getLandmarkTurns('g1', 0)).toEqual([]);
      expect(await writer.getLandmarkTurns('g1', 1)).toEqual([]);
    });
  });

  describe('getGameEpisodeVectors', () => {
    it('should return PK + vectors ordered by turn for episodes with vectors', async () => {
      await writer.writeEpisodes([
        makeEpisode({ gameId: 'g1', turn: 2, playerId: 0, gameStateVector: [9, 8], neighborVector: [7, 6], situationAbstractEmbedding: [1, 2] }),
        makeEpisode({ gameId: 'g1', turn: 1, playerId: 0, gameStateVector: [1, 2], neighborVector: [3, 4], situationAbstractEmbedding: null }),
      ]);
      const rows = await writer.getGameEpisodeVectors('g1');
      expect(rows.map(r => r.turn)).toEqual([1, 2]);
      expect(rows[0].gameStateVector.map(Number)).toEqual([1, 2]);
      expect(rows[0].neighborVector.map(Number)).toEqual([3, 4]);
      expect(rows[0].situationAbstractEmbedding).toBeNull();
      expect(rows[1].situationAbstractEmbedding!.map(Number)).toEqual([1, 2]);
    });
  });

  describe('updateEpisodeTexts', () => {
    it('should update text fields and embedding for the matching episode', async () => {
      await writer.writeEpisodes([
        makeEpisode({ gameId: 'g1', turn: 5, playerId: 0 }),
      ]);
      await writer.updateEpisodeTexts('g1', 0, [
        {
          turn: 5,
          situationAbstract: 'sit-abs',
          decisionAbstract: 'dec-abs',
          situation: 'the situation',
          decisions: 'the decisions',
          situationAbstractEmbedding: [0.11, 0.22, 0.33],
        },
      ]);
      const rows = await queryAll(
        "SELECT situation_abstract, decision_abstract, situation, decisions, situation_abstract_embedding FROM episodes WHERE turn = 5"
      );
      expect(rows[0].situation_abstract).toBe('sit-abs');
      expect(rows[0].decision_abstract).toBe('dec-abs');
      expect(rows[0].situation).toBe('the situation');
      expect(rows[0].decisions).toBe('the decisions');
      const emb = (rows[0].situation_abstract_embedding as number[]).map(Number);
      emb.forEach((v, i) => expect(v).toBeCloseTo([0.11, 0.22, 0.33][i], 4));
    });

    it('should be a no-op for an empty updates array', async () => {
      await writer.writeEpisodes([makeEpisode({ gameId: 'g1', turn: 5, playerId: 0 })]);
      await writer.updateEpisodeTexts('g1', 0, []);
      const rows = await queryAll("SELECT situation_abstract FROM episodes WHERE turn = 5");
      expect(rows[0].situation_abstract).toBeNull();
    });
  });

  describe('delete helpers', () => {
    beforeEach(async () => {
      await writer.writeEpisodes([
        makeEpisode({ gameId: 'g1', turn: 1, playerId: 0 }),
        makeEpisode({ gameId: 'g1', turn: 1, playerId: 1 }),
        makeEpisode({ gameId: 'g2', turn: 1, playerId: 0 }),
      ]);
    });

    it('should delete only the given player episodes in a game', async () => {
      await writer.deletePlayerEpisodes('g1', 0);
      const rows = await queryAll('SELECT game_id, player_id FROM episodes ORDER BY game_id, player_id');
      expect(rows.map(r => `${r.game_id}:${Number(r.player_id)}`)).toEqual(['g1:1', 'g2:0']);
    });

    it('should delete all episodes for a game', async () => {
      await writer.deleteGameEpisodes('g1');
      const rows = await queryAll('SELECT game_id FROM episodes');
      expect(rows.map(r => r.game_id)).toEqual(['g2']);
    });
  });
});
