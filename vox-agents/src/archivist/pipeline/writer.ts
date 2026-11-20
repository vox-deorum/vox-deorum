/**
 * @module archivist/pipeline/writer
 *
 * DuckDB output writer for the archivist pipeline.
 * Uses Kysely with CamelCasePlugin for type-safe access to the episodes table,
 * which stores player-turn snapshots from archived Civilization V games.
 * The table is created via raw SQL to support DuckDB-specific REAL[] array columns.
 */

import { Kysely, CamelCasePlugin, sql } from 'kysely';
import { DuckDbDialect } from 'kysely-duckdb';
import { DuckDBInstance, DuckDBListType, FLOAT, listValue } from '@duckdb/node-api';
import { createLogger } from '../../utils/logger.js';
import { getEpisodeDbInstance } from '../episode-db.js';
import type { Episode, EpisodesDatabase, StoryPitch, StorySampleKey } from '../types.js';

/** DuckDB LIST(FLOAT) type for appender list columns. */
const realListType = new DuckDBListType(FLOAT);

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS episodes (
  game_id         VARCHAR NOT NULL,
  turn            INTEGER NOT NULL,
  player_id       INTEGER NOT NULL,
  civilization    VARCHAR NOT NULL,
  is_winner       BOOLEAN NOT NULL,

  era             VARCHAR NOT NULL,
  grand_strategy  VARCHAR,

  is_vassal         INTEGER NOT NULL DEFAULT 0,
  active_wars       INTEGER NOT NULL DEFAULT 0,
  truces            INTEGER NOT NULL DEFAULT 0,
  defensive_pacts   INTEGER NOT NULL DEFAULT 0,
  friends           INTEGER NOT NULL DEFAULT 0,
  denouncements     INTEGER NOT NULL DEFAULT 0,
  vassals           INTEGER NOT NULL DEFAULT 0,
  war_weariness     REAL NOT NULL DEFAULT 0,

  score               INTEGER,
  cities              INTEGER,
  population          INTEGER,
  gold_per_turn       REAL,
  culture_per_turn    REAL,
  tourism_per_turn    REAL,
  military_strength   REAL,
  technologies        INTEGER,
  votes               INTEGER,
  happiness_percentage REAL,

  production_per_turn REAL,
  food_per_turn       REAL,

  policies            INTEGER,

  minor_allies        INTEGER,
  military_units      INTEGER,
  military_supply     INTEGER,

  domination_progress   REAL,
  science_progress      REAL,
  culture_progress      REAL,
  diplomatic_progress   REAL,

  domination_leader_progress  REAL,
  science_leader_progress     REAL,
  culture_leader_progress     REAL,
  diplomatic_leader_progress  REAL,

  culture_per_pop     REAL,
  tourism_share       REAL,
  gold_per_pop        REAL,
  science_per_pop     REAL,
  faith_per_pop       REAL,
  production_per_pop  REAL,
  food_per_pop        REAL,
  military_share      REAL,
  cities_share        REAL,
  population_share    REAL,
  votes_share         REAL,
  minor_allies_share  REAL,

  technologies_gap    INTEGER,
  policies_gap        INTEGER,

  religion_percentage REAL,

  supply_utilization  REAL,

  ideology_allies     INTEGER NOT NULL DEFAULT 0,
  ideology_share      REAL NOT NULL DEFAULT 0,

  game_state_vector   REAL[],
  neighbor_vector     REAL[],

  situation_abstract            TEXT,
  decision_abstract             TEXT,
  situation_abstract_embedding  REAL[],
  situation           TEXT,
  decisions           TEXT,

  is_landmark         BOOLEAN NOT NULL DEFAULT FALSE,

  PRIMARY KEY (game_id, turn, player_id)
)`;

const GAME_OUTCOMES_DDL = `
CREATE TABLE IF NOT EXISTS game_outcomes (
  game_id           VARCHAR NOT NULL PRIMARY KEY,
  winner_player_id  INTEGER NOT NULL,
  victory_type      VARCHAR,
  max_turn          INTEGER NOT NULL
)`;

const storyPitchesDdl = `
CREATE TABLE IF NOT EXISTS story_pitches (
  game_id       VARCHAR NOT NULL,
  player_id     INTEGER NOT NULL,
  turn          INTEGER NOT NULL,
  model         VARCHAR NOT NULL,
  pitch_index   INTEGER NOT NULL,
  civilization  VARCHAR NOT NULL,
  era           VARCHAR NOT NULL,
  subject       VARCHAR NOT NULL,
  genre         VARCHAR NOT NULL,
  stance        VARCHAR NOT NULL,
  voice         VARCHAR,
  pitch         VARCHAR NOT NULL,
  headline      VARCHAR NOT NULL,
  content       VARCHAR,
  basis         VARCHAR NOT NULL,
  wants         VARCHAR NOT NULL,
  embedding     REAL[],
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, player_id, turn, model, pitch_index)
)`;

/** Writes episode data to a DuckDB database using Kysely with CamelCasePlugin. */
export class EpisodeWriter {
  private db: Kysely<EpisodesDatabase>;
  private instance: DuckDBInstance;
  private logger = createLogger('EpisodeWriter');

  private constructor(db: Kysely<EpisodesDatabase>, instance: DuckDBInstance) {
    this.db = db;
    this.instance = instance;
  }

  /** Open the episode database and ensure its tables exist. */
  static async create(dbPath: string): Promise<EpisodeWriter> {
    const instance = await getEpisodeDbInstance(dbPath);
    const db = new Kysely<EpisodesDatabase>({
      dialect: new DuckDbDialect({ database: instance, tableMappings: {} }),
      plugins: [new CamelCasePlugin()],
    });

    const writer = new EpisodeWriter(db, instance);
    await writer.ensureTable();
    return writer;
  }

  /** Create the episode, outcome, and pitch tables. Raw SQL supports REAL[] columns. */
  private async ensureTable(): Promise<void> {
    await sql.raw(TABLE_DDL).execute(this.db);
    await sql.raw(GAME_OUTCOMES_DDL).execute(this.db);
    await this.ensureStoryPitchesTable();
    this.logger.info('Episode database tables ensured');
  }

  /** Create the pitch table or move saved pitches into the new column order. */
  private async ensureStoryPitchesTable(): Promise<void> {
    await this.db.transaction().execute(async tx => {
      await sql.raw(storyPitchesDdl).execute(tx);
      const { rows } = await sql`SELECT 1 FROM pragma_table_info('story_pitches') WHERE name = 'voice'`.execute(tx);
      if (rows.length) return;

      await sql`ALTER TABLE story_pitches RENAME TO story_pitches_legacy`.execute(tx);
      await sql.raw(storyPitchesDdl).execute(tx);
      await sql`INSERT INTO story_pitches (game_id, player_id, turn, model, pitch_index, civilization, era,
        subject, genre, stance, pitch, headline, basis, wants, embedding, created_at)
        SELECT game_id, player_id, turn, model, pitch_index, civilization, era,
          subject, genre, stance, pitch, headline, basis, wants, embedding, created_at
        FROM story_pitches_legacy`.execute(tx);
      await sql`DROP TABLE story_pitches_legacy`.execute(tx);
    });
  }

  /** Read the civilization and era Phase A recorded for a sampled player turn. */
  async getEpisodeIdentity(gameId: string, playerId: number, turn: number) {
    return this.db.selectFrom('episodes')
      .select(['civilization', 'era'])
      .where('gameId', '=', gameId)
      .where('playerId', '=', playerId)
      .where('turn', '=', turn)
      .executeTakeFirst();
  }

  /** List the turns with saved pitches for this game, player and model. */
  async getStorySampleTurns(gameId: string, playerId: number, model: string): Promise<Set<number>> {
    const rows = await this.db.selectFrom('storyPitches')
      .select('turn')
      .distinct()
      .where('gameId', '=', gameId)
      .where('playerId', '=', playerId)
      .where('model', '=', model)
      .execute();
    return new Set(rows.map(row => row.turn));
  }

  /** Save a complete sample, replacing any prior pitches for this key in the same transaction. */
  async writeStoryPitches(
    { gameId, playerId, turn, model }: StorySampleKey,
    { civilization, era }: Pick<Episode, 'civilization' | 'era'>,
    pitches: (StoryPitch & { embedding: number[] | null })[],
    replace: boolean,
  ): Promise<void> {
    if (pitches.length === 0) return;

    const rows = pitches.map((p, index) => [
      gameId, playerId, turn, model, index, civilization, era,
      p.subject, p.genre, p.stance, p.voice, p.pitch, p.headline, p.content, p.basis, p.wants, p.embedding,
    ]);
    const placeholders = rows.map(row => `(${row.map(() => '?').join(', ')})`).join(', ');
    const conn = await this.instance.connect();
    try {
      await conn.run('BEGIN');
      try {
        if (replace) {
          await conn.run('DELETE FROM story_pitches WHERE game_id = ? AND player_id = ? AND turn = ? AND model = ?',
            [gameId, playerId, turn, model]);
        }
        const stmt = await conn.prepare(
          `INSERT INTO story_pitches (game_id, player_id, turn, model, pitch_index, civilization, era,
             subject, genre, stance, voice, pitch, headline, content, basis, wants, embedding) VALUES ${placeholders}`,
        );
        let param = 1;
        for (const value of rows.flat()) {
          if (Array.isArray(value)) stmt.bindList(param++, listValue(value), realListType);
          else stmt.bindValue(param++, value);
        }
        await stmt.run();
        await conn.run('COMMIT');
      } catch (error) {
        await conn.run('ROLLBACK').catch(rollbackError => {
          this.logger.error('Failed to roll back story sample', { gameId, playerId, turn, model, error: rollbackError });
        });
        throw error;
      }
    } finally {
      conn.disconnectSync();
    }
  }

  /** Return the set of player IDs already processed for a given game. */
  async getProcessedPlayers(gameId: string): Promise<Set<number>> {
    const rows = await this.db
      .selectFrom('episodes')
      .select('playerId')
      .where('gameId', '=', gameId)
      .groupBy('playerId')
      .execute();
    return new Set(rows.map(r => r.playerId));
  }

  /**
   * Bulk insert episodes into DuckDB using the Appender API.
   * Bypasses SQL parsing entirely for dramatically faster writes with large REAL[] columns.
   */
  async writeEpisodes(episodes: Episode[]): Promise<void> {
    if (episodes.length === 0) return;

    const totalStart = performance.now();
    const embDim = episodes.find(ep => ep.situationAbstractEmbedding)?.situationAbstractEmbedding?.length ?? 0;
    this.logger.debug(`Appending ${episodes.length} episodes (embDim=${embDim})`);

    const conn = await this.instance.connect();
    try {
      const appender = await conn.createAppender('episodes');

      for (const ep of episodes) {
        // Identity — columns 1-5
        appender.appendVarchar(ep.gameId);
        appender.appendInteger(ep.turn);
        appender.appendInteger(ep.playerId);
        appender.appendVarchar(ep.civilization);
        appender.appendBoolean(ep.isWinner);

        // Basic state — columns 6-7
        appender.appendVarchar(ep.era);
        ep.grandStrategy != null ? appender.appendVarchar(ep.grandStrategy) : appender.appendNull();

        // Diplomatic counts — columns 8-15
        appender.appendInteger(ep.isVassal);
        appender.appendInteger(ep.activeWars);
        appender.appendInteger(ep.truces);
        appender.appendInteger(ep.defensivePacts);
        appender.appendInteger(ep.friends);
        appender.appendInteger(ep.denouncements);
        appender.appendInteger(ep.vassals);
        appender.appendFloat(ep.warWeariness);

        // Raw values (nullable) — columns 16-28
        ep.score != null ? appender.appendInteger(ep.score) : appender.appendNull();
        ep.cities != null ? appender.appendInteger(ep.cities) : appender.appendNull();
        ep.population != null ? appender.appendInteger(ep.population) : appender.appendNull();
        ep.goldPerTurn != null ? appender.appendFloat(ep.goldPerTurn) : appender.appendNull();
        ep.culturePerTurn != null ? appender.appendFloat(ep.culturePerTurn) : appender.appendNull();
        ep.tourismPerTurn != null ? appender.appendFloat(ep.tourismPerTurn) : appender.appendNull();
        ep.militaryStrength != null ? appender.appendFloat(ep.militaryStrength) : appender.appendNull();
        ep.technologies != null ? appender.appendInteger(ep.technologies) : appender.appendNull();
        ep.votes != null ? appender.appendInteger(ep.votes) : appender.appendNull();
        ep.happinessPercentage != null ? appender.appendFloat(ep.happinessPercentage) : appender.appendNull();
        ep.productionPerTurn != null ? appender.appendFloat(ep.productionPerTurn) : appender.appendNull();
        ep.foodPerTurn != null ? appender.appendFloat(ep.foodPerTurn) : appender.appendNull();
        ep.policies != null ? appender.appendInteger(ep.policies) : appender.appendNull();
        ep.minorAllies != null ? appender.appendInteger(ep.minorAllies) : appender.appendNull();
        ep.militaryUnits != null ? appender.appendInteger(ep.militaryUnits) : appender.appendNull();
        ep.militarySupply != null ? appender.appendInteger(ep.militarySupply) : appender.appendNull();

        // Victory progress (nullable)
        ep.dominationProgress != null ? appender.appendFloat(ep.dominationProgress) : appender.appendNull();
        ep.scienceProgress != null ? appender.appendFloat(ep.scienceProgress) : appender.appendNull();
        ep.cultureProgress != null ? appender.appendFloat(ep.cultureProgress) : appender.appendNull();
        ep.diplomaticProgress != null ? appender.appendFloat(ep.diplomaticProgress) : appender.appendNull();
        ep.dominationLeaderProgress != null ? appender.appendFloat(ep.dominationLeaderProgress) : appender.appendNull();
        ep.scienceLeaderProgress != null ? appender.appendFloat(ep.scienceLeaderProgress) : appender.appendNull();
        ep.cultureLeaderProgress != null ? appender.appendFloat(ep.cultureLeaderProgress) : appender.appendNull();
        ep.diplomaticLeaderProgress != null ? appender.appendFloat(ep.diplomaticLeaderProgress) : appender.appendNull();

        // Shares (nullable) — columns 37-48
        ep.culturePerPop != null ? appender.appendFloat(ep.culturePerPop) : appender.appendNull();
        ep.tourismShare != null ? appender.appendFloat(ep.tourismShare) : appender.appendNull();
        ep.goldPerPop != null ? appender.appendFloat(ep.goldPerPop) : appender.appendNull();
        ep.sciencePerPop != null ? appender.appendFloat(ep.sciencePerPop) : appender.appendNull();
        ep.faithPerPop != null ? appender.appendFloat(ep.faithPerPop) : appender.appendNull();
        ep.productionPerPop != null ? appender.appendFloat(ep.productionPerPop) : appender.appendNull();
        ep.foodPerPop != null ? appender.appendFloat(ep.foodPerPop) : appender.appendNull();
        ep.militaryShare != null ? appender.appendFloat(ep.militaryShare) : appender.appendNull();
        ep.citiesShare != null ? appender.appendFloat(ep.citiesShare) : appender.appendNull();
        ep.populationShare != null ? appender.appendFloat(ep.populationShare) : appender.appendNull();
        ep.votesShare != null ? appender.appendFloat(ep.votesShare) : appender.appendNull();
        ep.minorAlliesShare != null ? appender.appendFloat(ep.minorAlliesShare) : appender.appendNull();

        // Gaps and derived
        appender.appendInteger(ep.technologiesGap);
        appender.appendInteger(ep.policiesGap);
        appender.appendFloat(ep.religionPercentage);
        ep.supplyUtilization != null ? appender.appendFloat(ep.supplyUtilization) : appender.appendNull();
        appender.appendInteger(ep.ideologyAllies);
        appender.appendFloat(ep.ideologyShare);

        // Vectors — columns 54-55
        ep.gameStateVector ? appender.appendList(ep.gameStateVector, realListType) : appender.appendNull();
        ep.neighborVector ? appender.appendList(ep.neighborVector, realListType) : appender.appendNull();

        // Text fields — columns 56-60
        ep.situationAbstract != null ? appender.appendVarchar(ep.situationAbstract) : appender.appendNull();
        ep.decisionAbstract != null ? appender.appendVarchar(ep.decisionAbstract) : appender.appendNull();
        ep.situationAbstractEmbedding ? appender.appendList(ep.situationAbstractEmbedding, realListType) : appender.appendNull();
        ep.situation != null ? appender.appendVarchar(ep.situation) : appender.appendNull();
        ep.decisions != null ? appender.appendVarchar(ep.decisions) : appender.appendNull();

        // Landmark flag — column 61
        appender.appendBoolean(ep.isLandmark);

        appender.endRow();
      }

      appender.flushSync();
      appender.closeSync();
    } finally {
      conn.disconnectSync();
    }

    const totalMs = performance.now() - totalStart;
    this.logger.info(`Wrote ${episodes.length} episodes in ${(totalMs / 1000).toFixed(1)}s via appender`);
  }

  /** Insert or update game outcome metadata (winner, victory type, max turn). */
  async writeGameOutcome(
    gameId: string,
    winnerPlayerId: number,
    victoryType: string | null,
    maxTurn: number
  ): Promise<void> {
    const conn = await this.instance.connect();
    try {
      const stmt = await conn.prepare(
        `INSERT INTO game_outcomes (game_id, winner_player_id, victory_type, max_turn)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (game_id) DO UPDATE SET
           winner_player_id = EXCLUDED.winner_player_id,
           victory_type = EXCLUDED.victory_type,
           max_turn = EXCLUDED.max_turn`
      );
      stmt.bindVarchar(1, gameId);
      stmt.bindInteger(2, winnerPlayerId);
      victoryType != null ? stmt.bindVarchar(3, victoryType) : stmt.bindNull(3);
      stmt.bindInteger(4, maxTurn);
      await stmt.run();
    } finally {
      conn.disconnectSync();
    }
    this.logger.info(`Game outcome for ${gameId}: winner=${winnerPlayerId}, type=${victoryType}, maxTurn=${maxTurn}`);
  }

  /** Delete all episodes for a given game (used with --force flag). */
  async deleteGameEpisodes(gameId: string): Promise<void> {
    await this.db.deleteFrom('episodes').where('gameId', '=', gameId).execute();
  }

  /** Delete episodes for a specific player in a game. */
  async deletePlayerEpisodes(gameId: string, playerId: number): Promise<void> {
    await this.db.deleteFrom('episodes')
      .where('gameId', '=', gameId)
      .where('playerId', '=', playerId)
      .execute();
  }

  /** Reset all landmark flags for a game so they can be re-selected fresh. */
  async resetGameLandmarks(gameId: string): Promise<void> {
    await this.db.updateTable('episodes')
      .set({ isLandmark: false } as any)
      .where('gameId', '=', gameId)
      .execute();
  }

  /** Fetch vectors needed for landmark selection (lightweight: only PKs + vectors). */
  async getGameEpisodeVectors(gameId: string): Promise<Array<{
    turn: number;
    playerId: number;
    gameStateVector: number[];
    neighborVector: number[];
    situationAbstractEmbedding: number[] | null;
  }>> {
    const rows = await this.db
      .selectFrom('episodes')
      .select(['turn', 'playerId', 'gameStateVector', 'neighborVector', 'situationAbstractEmbedding'])
      .where('gameId', '=', gameId)
      .where('gameStateVector', 'is not', null)
      .orderBy('turn')
      .execute();
    return rows as any;
  }

  /** Mark selected episodes as landmarks for retrieval diversity. */
  async markLandmarks(gameId: string, keys: Array<{ turn: number; playerId: number }>): Promise<void> {
    for (const { turn, playerId } of keys) {
      await this.db.updateTable('episodes')
        .set({ isLandmark: true } as any)
        .where('gameId', '=', gameId)
        .where('turn', '=', turn)
        .where('playerId', '=', playerId)
        .execute();
    }
  }

  /** Unmark a single episode as no longer a landmark (e.g. context window exceeded). */
  async unmarkLandmark(gameId: string, playerId: number, turn: number): Promise<void> {
    await this.db.updateTable('episodes')
      .set({ isLandmark: false } as any)
      .where('gameId', '=', gameId)
      .where('playerId', '=', playerId)
      .where('turn', '=', turn)
      .execute();
  }

  /** Return landmark turn numbers for a specific player in a game. */
  async getLandmarkTurns(gameId: string, playerId: number): Promise<number[]> {
    const rows = await this.db
      .selectFrom('episodes')
      .select('turn')
      .where('gameId', '=', gameId)
      .where('playerId', '=', playerId)
      .where('isLandmark', '=', true as any)
      .orderBy('turn')
      .execute();
    return rows.map(r => r.turn);
  }

  /** Return landmark turn numbers that already have embeddings for a specific player in a game. */
  async getEmbeddedLandmarkTurns(gameId: string, playerId: number): Promise<Set<number>> {
    const rows = await this.db
      .selectFrom('episodes')
      .select('turn')
      .where('gameId', '=', gameId)
      .where('playerId', '=', playerId)
      .where('isLandmark', '=', true as any)
      .where('situationAbstractEmbedding', 'is not', null)
      .execute();
    return new Set(rows.map(r => r.turn));
  }

  /** Return all turn numbers for a specific player in a game. */
  async getPlayerTurns(gameId: string, playerId: number): Promise<Set<number>> {
    const rows = await this.db
      .selectFrom('episodes')
      .select('turn')
      .where('gameId', '=', gameId)
      .where('playerId', '=', playerId)
      .orderBy('turn')
      .execute();
    return new Set(rows.map(r => r.turn));
  }

  /** Update text fields and embedding for specific episodes (used after deferred summary generation). */
  async updateEpisodeTexts(
    gameId: string,
    playerId: number,
    updates: Array<{
      turn: number;
      situationAbstract: string | null;
      decisionAbstract: string | null;
      situation: string | null;
      decisions: string | null;
      situationAbstractEmbedding: number[] | null;
    }>
  ): Promise<void> {
    if (updates.length === 0) return;

    // Use prepared statement with typed bindList to handle REAL[] columns correctly
    const conn = await this.instance.connect();
    try {
      const stmt = await conn.prepare(
        `UPDATE episodes SET situation_abstract = $1, decision_abstract = $2, situation = $3, decisions = $4, situation_abstract_embedding = $5
         WHERE game_id = $6 AND turn = $7 AND player_id = $8`
      );

      for (const u of updates) {
        u.situationAbstract != null ? stmt.bindVarchar(1, u.situationAbstract) : stmt.bindNull(1);
        u.decisionAbstract != null ? stmt.bindVarchar(2, u.decisionAbstract) : stmt.bindNull(2);
        u.situation != null ? stmt.bindVarchar(3, u.situation) : stmt.bindNull(3);
        u.decisions != null ? stmt.bindVarchar(4, u.decisions) : stmt.bindNull(4);
        u.situationAbstractEmbedding
          ? stmt.bindList(5, listValue(u.situationAbstractEmbedding), realListType)
          : stmt.bindNull(5);
        stmt.bindVarchar(6, gameId);
        stmt.bindInteger(7, u.turn);
        stmt.bindInteger(8, playerId);
        await stmt.run();
      }
    } finally {
      conn.disconnectSync();
    }

    this.logger.info(`Updated ${updates.length} episode texts for player ${playerId} in game ${gameId}`);
  }

  /** Close the DuckDB connection. */
  async close(): Promise<void> {
    await this.db.destroy();
    this.logger.info('DuckDB connection closed');
  }
}
