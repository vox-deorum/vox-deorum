/**
 * @module archivist/console
 *
 * CLI entry point for the Archivist pipeline.
 * Processes archived Civilization V game databases into a DuckDB episodes table,
 * where each row is a player-turn snapshot for LLM-controlled players.
 *
 * Three-phase pipeline:
 *   Phase A: Extract + Transform + Write (no LLM calls)
 *   Phase B: Select diverse landmarks per player
 *   Phase C: Generate summaries + embeddings for landmark and consequence turns only
 *
 * Supports multiple models via comma-separated -m flag. Each model gets its own
 * worker that pulls games from a shared queue, enabling concurrent processing.
 *
 * Usage:
 *   npm run archivist -- -a <archive-path> -o <output.duckdb> [-g <gameId>] [-n <limit>] [-m <model1,model2>] [--force] [--skip-telepathist] [--skip-embeddings] [--no-ui]
 */

import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { config } from '../utils/config.js';
import { getEpisodeDbInstance } from './episode-db.js';
import { createLogger } from '../utils/logger.js';
import { openReadonlyGameDb, getWinner } from '../utils/telemetry/knowledge-db.js';
import { scanArchive } from './pipeline/scanner.js';
import { EpisodeWriter } from './pipeline/writer.js';
import type { ArchiveEntry } from './types.js';
import { prepareTelepathist } from './pipeline/telepathist-prep.js';
import { extractPlayerEpisodes, extractTurnContexts, getAgentTurns, loadTurnSummaries } from './pipeline/extractor.js';
import { transformEpisode } from './pipeline/transformer.js';
import { generateEmbeddings } from './pipeline/embeddings.js';
import { selectLandmarks } from './pipeline/selector.js';
import { computeTargetTurns, type WorkerStats } from './pipeline/target-turns.js';
import { startWebServer } from '../web/server.js';
import { processManager } from '../infra/process-manager.js';

const logger = createLogger('Archivist');

/** Parse CLI flags */
const { values } = parseArgs({
  options: {
    archive: { type: 'string', short: 'a' },
    output: { type: 'string', short: 'o' },
    game: { type: 'string', short: 'g' },
    limit: { type: 'string', short: 'n' },
    model: { type: 'string', short: 'm' },
    force: { type: 'boolean', default: false },
    'skip-telepathist': { type: 'boolean', default: false },
    'skip-embeddings': { type: 'boolean', default: false },
    'no-ui': { type: 'boolean', default: false },
  },
  strict: false,
  allowPositionals: false,
});

// ---------------------------------------------------------------------------
// Graceful shutdown state
// ---------------------------------------------------------------------------

let shuttingdown = false;
let shuttingdownAfter = false;
let rl: readline.Interface | null = null;

/**
 * Process a single game through the full A→B→C pipeline.
 * Designed to run concurrently across workers — the DuckDB writer handles
 * internal concurrency (creates connection per operation).
 */
async function processGame(
  entry: ArchiveEntry,
  writer: EpisodeWriter,
  modelOverride: string | undefined,
  force: boolean,
  skipTelepathist: boolean,
  skipEmbeddings: boolean,
  stats: WorkerStats,
  workerLabel: string,
): Promise<void> {
  // Game-level completeness check: skip Phase A+B if all players already processed
  let skipPhaseAB = false;
  if (!force) {
    const existingPlayers = await writer.getProcessedPlayers(entry.gameId);
    const allPlayersProcessed = entry.players.every(p => existingPlayers.has(p.playerId));
    if (allPlayersProcessed) {
      if (skipTelepathist && skipEmbeddings) {
        logger.info(`[${workerLabel}] Skipping game ${entry.gameId} (already complete, Phase C disabled)`);
        stats.skipped += entry.players.length;
        return;
      }
      skipPhaseAB = true;
      logger.info(`[${workerLabel}] Game ${entry.gameId} Phase A+B complete, checking Phase C`);
    }
  }

  // Collect all turn numbers for consequence turn lookup in Phase C
  let allTurns: Set<number> | undefined;

  if (!skipPhaseAB) {
    logger.info(`[${workerLabel}] Processing game ${entry.gameId} (${entry.experiment})`, {
      players: entry.players.length,
    });

    if (force) {
      await writer.resetGameLandmarks(entry.gameId);
    }

    // Open game DB for extraction
    const gameDb = openReadonlyGameDb(entry.gameDbPath);
    if (!gameDb) {
      logger.error(`[${workerLabel}] Failed to open game DB for ${entry.gameId}, skipping`);
      stats.errors++;
      return;
    }

    try {
      // Query game metadata for winner determination
      const winner = await getWinner(gameDb);
      const victoryPlayerId = winner?.playerID ?? -1;
      const victoryType = winner?.victoryType ?? null;

      // Build player info lookup (ID -> civ name + leader name)
      const playerInfoRows = await gameDb
        .selectFrom('PlayerInformations')
        .selectAll()
        .execute();
      const playerInfoMap = new Map(playerInfoRows.map((r) => [r.Key, r]));

      // Extract turn contexts once per game (shared across all players)
      const turnContexts = await extractTurnContexts(gameDb);
      allTurns = new Set(turnContexts.keys());

      const maxTurn = allTurns.size > 0 ? Math.max(...allTurns) : 0;

      await writer.writeGameOutcome(entry.gameId, victoryPlayerId, victoryType, maxTurn);

      const existingPlayers = await writer.getProcessedPlayers(entry.gameId);

      // ---------------------------------------------------------------
      // Phase A: Extract + Transform + Write (no LLM calls)
      // ---------------------------------------------------------------
      for (const player of entry.players) {
        if (!force && existingPlayers.has(player.playerId)) {
          logger.info(`[${workerLabel}] Skipping player ${player.playerId} (already processed)`);
          stats.skipped++;
          continue;
        }

        try {
          const info = playerInfoMap.get(player.playerId);
          const civilization = info?.Civilization ?? 'Unknown';

          const agentTurns = getAgentTurns(player.telemetryDbPath);

          const rawEpisodes = await extractPlayerEpisodes(
            gameDb,
            player.telepathistDbPath,
            player.playerId,
            civilization,
            turnContexts,
            entry.gameId,
            victoryPlayerId,
            agentTurns
          );

          logger.info(`[${workerLabel}] Extracted ${rawEpisodes.length} raw episodes for player ${player.playerId}`);

          const episodes = rawEpisodes.map(raw => {
            const tc = turnContexts.get(raw.turn);
            if (!tc) throw new Error(`Missing TurnContext for turn ${raw.turn}`);
            return transformEpisode(raw, tc);
          });

          // In force mode, delete old rows before writing new ones
          if (force) {
            await writer.deletePlayerEpisodes(entry.gameId, player.playerId);
          }

          await writer.writeEpisodes(episodes);
          stats.processed++;
        } catch (playerError) {
          logger.error(`[${workerLabel}] Error processing player ${player.playerId} in game ${entry.gameId}`, {
            error: playerError instanceof Error ? { message: playerError.message, stack: playerError.stack } : playerError,
          });
          stats.errors++;
        }
      }
    } finally {
      await gameDb.destroy();
    }

    // ---------------------------------------------------------------
    // Phase B: Landmark selection (vectors only, no embeddings needed)
    // ---------------------------------------------------------------
    await selectLandmarks(writer, entry.gameId);

    stats.gamesProcessed++;
  }

  // ---------------------------------------------------------------
  // Phase C: Generate summaries + embeddings for selected turns only
  // ---------------------------------------------------------------
  if (!skipTelepathist || !skipEmbeddings) {
    for (const player of entry.players) {
      try {
        const landmarkTurns = await writer.getLandmarkTurns(entry.gameId, player.playerId);
        if (landmarkTurns.length === 0) {
          logger.info(`[${workerLabel}] No landmarks for player ${player.playerId}, skipping Phase C`);
          continue;
        }

        // Use game DB turns when available, otherwise query from DuckDB
        const playerTurns = allTurns ?? await writer.getPlayerTurns(entry.gameId, player.playerId);

        const { targetTurns, landmarkSet } = computeTargetTurns(landmarkTurns, playerTurns);

        // Generate telepathist summaries for target turns only
        if (!skipTelepathist) {
          logger.info(`[${workerLabel}] Player ${player.playerId}: generating summaries for ${targetTurns.length} turns (${landmarkTurns.length} landmarks + ${targetTurns.length - landmarkTurns.length} consequence)`);
          const contextExceededTurns = await prepareTelepathist(player.telemetryDbPath, entry.gameId, player.playerId, targetTurns, modelOverride);

          // Unmark landmark turns that exceeded the model's context window
          if (contextExceededTurns.size > 0) {
            logger.warn(`[${workerLabel}] Player ${player.playerId} in game ${entry.gameId}: ${contextExceededTurns.size} turns exceeded context window — consider using a model with a larger context`);
            const affectedLandmarks = landmarkTurns.filter(t => contextExceededTurns.has(t));
            if (affectedLandmarks.length > 0) {
              logger.warn(`[${workerLabel}] Player ${player.playerId}: unmarking ${affectedLandmarks.length} landmarks due to context window exceeded: turns ${affectedLandmarks.join(', ')}`);
              for (const turn of affectedLandmarks) {
                await writer.unmarkLandmark(entry.gameId, player.playerId, turn);
              }
              // Remove from landmarkSet so embeddings aren't attempted for these turns
              for (const turn of affectedLandmarks) {
                landmarkSet.delete(turn);
              }
            }
          }
        }

        // Load summaries for all target turns (prepareTelepathist skips existing ones internally)
        const summaries = loadTurnSummaries(player.telepathistDbPath, targetTurns);

        // Build update records for turns that have summaries
        const updates: Array<{
          turn: number;
          situationAbstract: string | null;
          decisionAbstract: string | null;
          situation: string | null;
          decisions: string | null;
          situationAbstractEmbedding: number[] | null;
        }> = [];

        for (const turn of targetTurns) {
          const summary = summaries.get(turn);
          if (!summary) continue;
          updates.push({
            turn,
            situationAbstract: summary.situationAbstract ?? null,
            decisionAbstract: summary.decisionAbstract ?? null,
            situation: summary.situation ?? null,
            decisions: summary.decisions ?? null,
            situationAbstractEmbedding: null, // filled below if needed
          });
        }

        // Generate embeddings for landmark turns with abstracts
        if (!skipEmbeddings) {
          const landmarkUpdates = updates.filter(u => landmarkSet.has(u.turn) && u.situationAbstract != null);
          if (landmarkUpdates.length > 0) {
            // In non-force mode, skip landmarks that already have embeddings
            let toEmbed = landmarkUpdates;
            if (!force) {
              const alreadyEmbedded = await writer.getEmbeddedLandmarkTurns(entry.gameId, player.playerId);
              toEmbed = landmarkUpdates.filter(u => !alreadyEmbedded.has(u.turn));
              const skippedCount = landmarkUpdates.length - toEmbed.length;
              if (skippedCount > 0) {
                logger.info(`[${workerLabel}] Player ${player.playerId}: skipped ${skippedCount} landmarks with existing embeddings`);
              }
            }
            if (toEmbed.length > 0) {
              const embeddings = await generateEmbeddings(toEmbed.map(u => u.situationAbstract));
              for (let i = 0; i < toEmbed.length; i++) {
                toEmbed[i].situationAbstractEmbedding = embeddings[i];
              }
            }
          }
        }

        if (updates.length > 0) {
          await writer.updateEpisodeTexts(entry.gameId, player.playerId, updates);
        }
      } catch (playerError) {
        logger.error(`[${workerLabel}] Error in Phase C for player ${player.playerId} in game ${entry.gameId}`, {
          error: playerError instanceof Error ? { message: playerError.message, stack: playerError.stack } : playerError,
        });
      }
    }
  }
}

/**
 * Worker loop: pulls games from a shared queue until empty or shutdown requested.
 * Each worker is assigned a fixed model for Phase C summaries.
 */
async function workerLoop(
  queue: ArchiveEntry[],
  writer: EpisodeWriter,
  modelOverride: string | undefined,
  force: boolean,
  skipTelepathist: boolean,
  skipEmbeddings: boolean,
  limit: number,
  dispatched: { count: number },
  workerLabel: string,
): Promise<WorkerStats> {
  const stats: WorkerStats = { processed: 0, skipped: 0, errors: 0, gamesProcessed: 0 };

  while (true) {
    // Check stop conditions before pulling next game
    if (shuttingdownAfter) {
      logger.info(`[${workerLabel}] Ctrl+A: stopping (no more games will be started)`);
      break;
    }
    if (dispatched.count >= limit) {
      break;
    }

    const entry = queue.shift();
    if (!entry) break;

    dispatched.count++;

    try {
      await processGame(entry, writer, modelOverride, force, skipTelepathist, skipEmbeddings, stats, workerLabel);
    } catch (error) {
      logger.error(`[${workerLabel}] Error processing game ${entry.gameId}`, error);
      stats.errors++;
    }
  }

  return stats;
}

async function main() {
  const archivePath = path.resolve(values.archive as string ?? 'archive');
  const outputPath = path.resolve(values.output as string ?? config.episodeDbPath);
  const gameFilter = values.game as string | undefined;
  const force = values.force as boolean;
  const limit = values.limit ? parseInt(values.limit as string, 10) : Infinity;
  const models = (values.model as string)?.split(',').map(s => s.trim()).filter(Boolean) ?? [];

  // Validate that all specified models exist in config
  const invalidModels = models.filter(m => !config.llms[m]);
  if (invalidModels.length > 0) {
    const available = Object.keys(config.llms).filter(k => typeof config.llms[k] !== 'string').join(', ');
    throw new Error(`Model(s) not found in config: ${invalidModels.join(', ')}. Available: ${available}`);
  }

  const skipTelepathist = values['skip-telepathist'] as boolean;
  const skipEmbeddings = values['skip-embeddings'] as boolean;
  const noUi = values['no-ui'] as boolean;

  logger.info('Archivist starting', { archivePath, outputPath, gameFilter, force, limit, models, skipTelepathist, skipEmbeddings, noUi });

  // Step 1: Scan archive for game entries
  const entries: ArchiveEntry[] = await scanArchive(archivePath, gameFilter);
  logger.info(`Found ${entries.length} game(s) to process`);

  if (entries.length === 0) {
    logger.warn('No games found in archive');
    return;
  }

  // Step 2: Initialize DuckDB writer
  const writer = await EpisodeWriter.create(outputPath);

  // Register shutdown hooks with processManager
  processManager.register('terminal', async () => {
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    if (rl) rl.close();
  });
  processManager.register('duckdb-ui', async () => {
    if (uiConn) {
      await uiConn.run('CALL stop_ui_server();').catch(() => {});
      uiConn.disconnectSync();
    }
  });

  // Setup readline for Ctrl+A
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('data', (key) => {
    if (key[0] === 1) {
      if (!shuttingdownAfter) {
        shuttingdownAfter = true;
        logger.info('Ctrl+A pressed: Will stop after current game(s) complete');
      } else {
        shuttingdownAfter = false;
        logger.info('Ctrl+A pressed again: Cancelled shutdown');
      }
    } else if (key[0] === 3) {
      processManager.shutdown('SIGINT');
    }
  });

  // Web UI
  await startWebServer();

  // DuckDB UI for live inspection during processing
  let uiConn: Awaited<ReturnType<Awaited<ReturnType<typeof getEpisodeDbInstance>>['connect']>> | null = null;
  if (!noUi) {
    logger.info('Starting DuckDB UI...');
    const uiInstance = await getEpisodeDbInstance(outputPath);
    uiConn = await uiInstance.connect();
    await uiConn.run('INSTALL ui; LOAD ui;');
    await uiConn.run('CALL start_ui_server();');

    const url = 'http://localhost:4213';
    const open = (await import('open')).default;
    await open(url);
    logger.info(`DuckDB UI running at ${url}`);
  }

  // Step 3: Spawn workers
  const queue = [...entries];
  const dispatched = { count: 0 };

  // One worker per model, or a single worker if no models specified
  const workerCount = Math.max(models.length, 1);
  const workerPromises: Promise<WorkerStats>[] = [];

  for (let i = 0; i < workerCount; i++) {
    const modelOverride = models.length > 0 ? models[i] : undefined;
    const label = models.length > 0 ? models[i] : 'default';
    workerPromises.push(
      workerLoop(queue, writer, modelOverride, force, skipTelepathist, skipEmbeddings, limit, dispatched, label)
    );
  }

  logger.info(`Spawned ${workerCount} worker(s)`, { models: models.length > 0 ? models : ['default'] });

  const results = await Promise.all(workerPromises);

  // Restore terminal
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
  }
  if (rl) rl.close();

  // Merge stats
  const totals = results.reduce(
    (acc, s) => ({
      processed: acc.processed + s.processed,
      skipped: acc.skipped + s.skipped,
      errors: acc.errors + s.errors,
      gamesProcessed: acc.gamesProcessed + s.gamesProcessed,
    }),
    { processed: 0, skipped: 0, errors: 0, gamesProcessed: 0 }
  );

  // Step 4: Close and summarize
  await writer.close();

  logger.info('Archivist complete', {
    games: entries.length,
    ...totals,
    output: outputPath,
  });

  // Keep DuckDB UI alive for result inspection after processing
  if (uiConn) {
    logger.info('Processing complete — DuckDB UI still running at http://localhost:4213 — press Ctrl+C to stop');

    await new Promise<void>((resolve) => {
      const keepAlive = setInterval(() => {}, 1 << 30);
      // processManager already has the duckdb-ui hook registered;
      // just need to keep the process alive until Ctrl+C triggers it
      processManager.register('duckdb-ui-keepalive', async () => {
        clearInterval(keepAlive);
        resolve();
      });
    });
  }
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
