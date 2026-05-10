/**
 * @module telepathist/telepathist-parameters
 *
 * Parameters and factory functions for the Telepathist agent system.
 * Manages two databases: the read-only telemetry DB and the read-write telepathist DB
 * for storing generated summaries and analyses.
 */

import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import { AgentParameters } from '../infra/vox-agent.js';
import { createLogger } from '../utils/logger.js';
import type { TelemetryDatabase } from '../utils/telemetry/schema.js';
import type { GameIdentifierInfo } from '../utils/telemetry/identifier-parser.js';

const logger = createLogger('TelepathistParameters');

/**
 * Schema for the turn_summaries table in the telepathist database
 */
export interface TurnSummaryRecord {
  turn: number;
  situation: string;
  situationAbstract: string;
  decisions: string;
  decisionAbstract: string;
  narrative: string;
  model: string;
  createdAt: number;
}

/**
 * Schema for the phase_summaries table in the telepathist database
 */
export interface PhaseSummaryRecord {
  fromTurn: number;
  toTurn: number;
  situation: string;
  situationAbstract: string;
  decisions: string;
  decisionAbstract: string;
  narrative: string;
  model: string;
  createdAt: number;
}

/**
 * Schema for the summary_cache table in the telepathist database.
 * Caches LLM-generated summaries of tool results to avoid redundant calls.
 */
export interface SummaryCacheRecord {
  cacheKey: string;
  result: string;
  model: string;
  createdAt: number;
}

/**
 * Database schema for the telepathist's generated data
 */
export interface TelepathistDatabase {
  turn_summaries: TurnSummaryRecord;
  phase_summaries: PhaseSummaryRecord;
  summary_cache: SummaryCacheRecord;
}

/**
 * Parameters for telepathist agents that read from telemetry databases.
 * Extends AgentParameters with database connections and game identity.
 */
export interface TelepathistParameters extends AgentParameters {
  /** Absolute path to the telemetry .db file */
  databasePath: string;
  /** Read-only Kysely connection to the telemetry database */
  db: Kysely<TelemetryDatabase>;
  /** Read-write Kysely connection for generated data (summaries, etc.) */
  telepathistDb: Kysely<TelepathistDatabase>;
  /** Civilization name (e.g. "Rome") */
  civilizationName: string;
  /** Leader name (e.g. "Augustus Caesar") */
  leaderName: string;
  /** Sorted list of turns available in the database */
  availableTurns: number[];
}

/**
 * Creates TelepathistParameters by opening databases and extracting game identity.
 *
 * @param databasePath - Absolute path to the telemetry database file
 * @param parsedId - Parsed game and player identifiers
 * @returns Fully initialized TelepathistParameters
 */
export async function createTelepathistParameters(
  databasePath: string,
  parsedId: GameIdentifierInfo
): Promise<TelepathistParameters> {
  // Open telemetry DB read-only
  const sqliteDb = new Database(databasePath, { readonly: true });
  const db = new Kysely<TelemetryDatabase>({
    dialect: new SqliteDialect({ database: sqliteDb }),
  });

  // Open/create telepathist DB for generated data
  const telepathistPath = databasePath.replace(/\.db$/, '.telepathist.db');
  const telepathistSqlite = new Database(telepathistPath);
  telepathistSqlite.pragma('journal_mode = WAL');
  telepathistSqlite.pragma('synchronous = NORMAL');

  const telepathistDb = new Kysely<TelepathistDatabase>({
    dialect: new SqliteDialect({ database: telepathistSqlite }),
  });

  /** Close both database connections */
  const close = async () => {
    logger.info('Closing telepathist database connections');
    try {
      await db.destroy();
    } catch (e) {
      logger.error('Error closing telemetry database', { error: e });
    }
    try {
      await telepathistDb.destroy();
    } catch (e) {
      logger.error('Error closing telepathist database', { error: e });
    }
  };

  try {
    // Create tables if they don't exist
    await telepathistDb.schema
      .createTable('turn_summaries')
      .ifNotExists()
      .addColumn('turn', 'integer', (col) => col.primaryKey())
      .addColumn('situation', 'text', (col) => col.notNull())
      .addColumn('situationAbstract', 'text', (col) => col.notNull())
      .addColumn('decisions', 'text', (col) => col.notNull())
      .addColumn('decisionAbstract', 'text', (col) => col.notNull())
      .addColumn('narrative', 'text', (col) => col.notNull())
      .addColumn('model', 'text', (col) => col.notNull())
      .addColumn('createdAt', 'integer', (col) => col.notNull())
      .execute();

    await telepathistDb.schema
      .createTable('phase_summaries')
      .ifNotExists()
      .addColumn('fromTurn', 'integer', (col) => col.notNull())
      .addColumn('toTurn', 'integer', (col) => col.notNull())
      .addColumn('situation', 'text', (col) => col.notNull())
      .addColumn('situationAbstract', 'text', (col) => col.notNull())
      .addColumn('decisions', 'text', (col) => col.notNull())
      .addColumn('decisionAbstract', 'text', (col) => col.notNull())
      .addColumn('narrative', 'text', (col) => col.notNull())
      .addColumn('model', 'text', (col) => col.notNull())
      .addColumn('createdAt', 'integer', (col) => col.notNull())
      .addPrimaryKeyConstraint('phase_summaries_pk', ['fromTurn', 'toTurn'])
      .execute();

    await telepathistDb.schema
      .createTable('summary_cache')
      .ifNotExists()
      .addColumn('cacheKey', 'text', (col) => col.primaryKey())
      .addColumn('result', 'text', (col) => col.notNull())
      .addColumn('model', 'text', (col) => col.notNull())
      .addColumn('createdAt', 'integer', (col) => col.notNull())
      .execute();

    // Query available turns
    const turnRows = await db
      .selectFrom('spans')
      .select('turn')
      .distinct()
      .where('turn', 'is not', null)
      .where('turn', '>=', 0)
      .orderBy('turn', 'asc')
      .execute();

    const availableTurns = turnRows.map(r => r.turn!);

    // Exclude the last turn if it has no agent activity (e.g. a victory termination turn)
    if (availableTurns.length > 0) {
      const lastTurn = availableTurns[availableTurns.length - 1];
      const agentSpan = await db
        .selectFrom('spans')
        .select('spanId')
        .where('turn', '=', lastTurn)
        .where('name', 'like', 'agent.%')
        .where('name', 'not like', '%.step.%')
        .limit(1)
        .executeTakeFirst();

      if (!agentSpan) {
        availableTurns.pop();
        logger.info(`Excluded empty terminal turn ${lastTurn}`);
      }
    }

    logger.info(`Found ${availableTurns.length} turns in telemetry database`, {
      firstTurn: availableTurns[0],
      lastTurn: availableTurns[availableTurns.length - 1]
    });

    // Extract player identity from the first get-game-settings span (or legacy get-metadata)
    let civilizationName = 'Unknown';
    let leaderName = 'Unknown';

    const metadataSpan = await db
      .selectFrom('spans')
      .selectAll()
      .where((eb) => eb.or([
        eb('name', '=', 'mcp-tool.get-game-settings'),
        eb('name', '=', 'mcp-tool.get-metadata')
      ]))
      .orderBy('startTime', 'asc')
      .limit(1)
      .executeTakeFirst();

    if (metadataSpan) {
      try {
        const attrs = typeof metadataSpan.attributes === 'string'
          ? JSON.parse(metadataSpan.attributes)
          : metadataSpan.attributes;
        const output = typeof attrs['tool.output'] === 'string'
          ? JSON.parse(attrs['tool.output'])
          : attrs['tool.output'];

        if (output?.YouAre?.Name) civilizationName = output.YouAre.Name;
        if (output?.YouAre?.Leader) leaderName = output.YouAre.Leader;

        logger.info(`Identified player: ${leaderName} of ${civilizationName}`);
      } catch (e) {
        logger.warn('Failed to parse metadata span output, using defaults', { error: e });
      }
    } else {
      logger.warn('No mcp-tool.get-game-settings span found, using default identity');
    }

    const lastTurn = availableTurns.length > 0 ? availableTurns[availableTurns.length - 1] : 0;

    return {
      playerID: parsedId.playerID,
      gameID: parsedId.gameID,
      turn: lastTurn,
      databasePath,
      db,
      telepathistDb,
      civilizationName,
      leaderName,
      availableTurns,
      close
    };
  } catch (error) {
    // Close DB connections if initialization fails after they were opened
    await close();
    throw error;
  }
}
