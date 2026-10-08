/**
 * @module oracle/retriever
 *
 * Retrieve phase: extracts raw prompt data from telemetry databases for each CSV row.
 * No LLM calls or prompt modifications: pure telemetry extraction.
 * The saved JSON files are experiment-agnostic and can be replayed with any config.
 */

import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { createLogger } from '../utils/logger.js';
import { discoverDbPath, openReadonlyDb } from './utils/db-resolver.js';
import { runOracleTasks } from './run-control.js';
import { extractPrompt, findTurnByRationale } from './utils/prompt-extractor.js';
import { resolvePath } from './utils/output.js';
import type { OracleConfig, OracleRow, RetrievedRow } from './types.js';

const logger = createLogger('OracleRetriever');

/**
 * Retrieve phase: read CSV, extract raw prompts from telemetry, optionally save as JSON files.
 *
 * @param config - Experiment configuration (uses csvPath, telemetryDir, outputDir, targetAgent, agentType, concurrency)
 * @param save - If true, write each RetrievedRow to {experimentDir}/retrieved/{gameId}-p{playerId}-t{turn}.json
 * @param shouldStop - Optional predicate that stops admitting queued rows
 * @returns Compact, source-ordered array of settled RetrievedRows
 */
export async function runRetrieve(
  config: OracleConfig,
  save = false,
  shouldStop?: () => boolean
): Promise<RetrievedRow[]> {
  const outputDir = resolvePath(config.outputDir || '../temp/oracle');
  const telemetryDir = resolvePath(config.telemetryDir || 'telemetry');
  const csvPath = resolvePath(config.csvPath);
  const retrieveBaseName = config.retrievalName ?? config.experimentName;
  const retrieveBaseDir = path.join(outputDir, retrieveBaseName);
  const retrieveDir = path.join(retrieveBaseDir, 'retrieved');

  if (save) {
    fs.mkdirSync(retrieveDir, { recursive: true });
  }

  // Read CSV
  logger.info(`Reading CSV: ${csvPath}`);
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const parsed = Papa.parse<OracleRow>(csvContent, { header: true, skipEmptyLines: true });

  if (parsed.errors.length > 0) {
    logger.warn(`CSV parse warnings: ${parsed.errors.map(e => e.message).join(', ')}`);
  }

  let rows = parsed.data;
  logger.info(`Loaded ${rows.length} rows from CSV`);

  // Apply filter if provided
  if (config.filter) {
    const before = rows.length;
    rows = rows.filter((row, i) => config.filter!(row, i));
    logger.info(`Filtered to ${rows.length} of ${before} rows`);
  }

  // Process rows in parallel while retaining graceful-stop admission boundaries.
  const { results, stopped } = await runOracleTasks(
    rows.map((row, i) =>
      async (): Promise<RetrievedRow> => {
        logger.info(`Retrieving row ${i + 1}/${rows.length}: game=${row.game_id}, player=${row.player_id}, turn=${row.turn}`);
        const retrieved = await retrieveRow(row, config, telemetryDir);

        if (retrieved.error) {
          logger.error(`Row ${i + 1} failed: ${retrieved.error}`);
        } else if (save) {
          // Normalize the turn the same way getTrailBase does (parseInt), so a padded
          // CSV turn like "030" writes t30.json instead of t030.json. Otherwise replay,
          // which looks up via getTrailBase, would miss the retrieved file.
          const trailBase = `${row.game_id}-p${row.player_id}-t${parseInt(row.turn, 10)}`;
          fs.writeFileSync(
            path.join(retrieveDir, `${trailBase}.json`),
            JSON.stringify(retrieved, null, 2)
          );
        }

        return retrieved;
      }
    ),
    config.concurrency ?? 5,
    shouldStop
  );

  const errors = results.filter(r => r.error).length;
  logger.info([
    stopped
      ? `Retrieve stopped: ${results.length - errors} succeeded, ${errors} failed, ${rows.length - results.length} never ran`
      : `Retrieve complete: ${results.length - errors} succeeded, ${errors} failed`,
    ...(save ? [`  Retrieved JSONs: ${retrieveDir}`] : []),
  ].join('\n'));

  return results;
}

/**
 * Extract raw telemetry data for a single CSV row.
 * On failure, returns a RetrievedRow with error set and empty arrays.
 */
async function retrieveRow(
  row: OracleRow,
  config: OracleConfig,
  telemetryDir: string
): Promise<RetrievedRow> {
  const { game_id: gameId, player_id: playerId, turn: turnStr } = row;
  const turn = parseInt(turnStr, 10);

  const base: RetrievedRow = {
    row,
    originalModel: '',
    agentName: '',
    agentType: config.agentType,
    system: [],
    messages: [],
    activeTools: [],
  };

  try {
    // Discover telemetry DB
    const dbPath = discoverDbPath(gameId, playerId, telemetryDir);
    if (!dbPath) {
      return { ...base, error: `No telemetry DB found for game=${gameId}, player=${playerId}` };
    }

    const db = openReadonlyDb(dbPath);
    if (!db) {
      return { ...base, error: `Failed to open telemetry DB: ${dbPath}` };
    }

    try {
      // Validate turn via rationale fuzzy matching, with fallback to previous turn.
      // A turn discarded by a reload is an error, never a reason to fall back.
      let effectiveTurn = turn;
      if (row.rationale) {
        const found = await findTurnByRationale(db, turn, row.rationale);
        if (found === 'discarded') {
          return { ...base, error: `Turn ${turn} was discarded by a later reload in ${dbPath}` };
        }
        if (found === 'mismatch') {
          const prevFound = await findTurnByRationale(db, turn - 1, row.rationale);
          if (prevFound === 'match') {
            logger.warn(`Rationale not found in turn ${turn}, using turn ${turn - 1} for game=${gameId}, player=${playerId}`);
            effectiveTurn = turn - 1;
          } else {
            logger.warn(`Rationale not found in turn ${turn} or ${turn - 1} for game=${gameId}, player=${playerId}`);
          }
        }
      }

      const extracted = await extractPrompt(db, effectiveTurn, config.targetAgent);
      if (!extracted) {
        return { ...base, error: `No prompt data found for turn ${effectiveTurn} in ${dbPath}` };
      }

      return {
        row,
        originalModel: extracted.modelString,
        agentName: extracted.agentName,
        agentType: config.agentType,
        system: extracted.system,
        messages: extracted.messages,
        activeTools: extracted.activeTools,
        stepTools: extracted.stepTools,
        framing: extracted.framing,
      };
    } finally {
      await db.destroy();
    }
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}
