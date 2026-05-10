/**
 * @module archivist/pipeline/telepathist-prep
 *
 * Wraps the existing telepathist preparation pipeline for batch archivist use.
 * Ensures turn summaries exist in the telepathist DB before episode extraction.
 * Creates a minimal VoxContext (no MCP connection needed) and delegates to
 * the existing prepareTurnSummaries which handles resume/skip natively.
 */

import { createLogger } from '../../utils/logger.js';
import type { GameIdentifierInfo } from '../../utils/telemetry/identifier-parser.js';
import { VoxContext } from '../../infra/vox-context.js';
import { prepareTurnSummaries } from '../../telepathist/preparation/turn-preparation.js';
import { createTelepathistParameters, TelepathistParameters } from '../../telepathist/telepathist-parameters.js';

const logger = createLogger('TelepathistPrep');

/**
 * Prepares telepathist turn summaries for an archived player's telemetry database.
 * Generates missing turn summaries via the Summarizer agent (requires LLM API key).
 * Idempotent: existing summaries are skipped automatically.
 *
 * @param telemetryDbPath - Absolute path to the player's telemetry database
 * @param gameId - Game identifier
 * @param playerId - Player ID within the game
 * @param targetTurns - Optional set of specific turns to summarize (default: all available turns)
 * @returns Set of turn numbers that failed due to context window exceeded
 */
export async function prepareTelepathist(
  telemetryDbPath: string,
  gameId: string,
  playerId: number,
  targetTurns?: number[],
  modelOverride?: string
): Promise<Set<number>> {
  logger.info(`Preparing telepathist for player ${playerId} in game ${gameId}`, {
    targetTurns: targetTurns ? targetTurns.length : 'all',
  });

  // Build identifier directly — archive filenames don't match parseDatabaseIdentifier's format
  const parsedId: GameIdentifierInfo = { gameID: gameId, playerID: playerId };

  let parameters: TelepathistParameters | undefined;
  let context: VoxContext<TelepathistParameters> | undefined;

  try {
    // Opens telemetry DB (read-only) + telepathist DB (read-write, created if absent)
    parameters = await createTelepathistParameters(telemetryDbPath, parsedId);

    // Filter to specific turns if requested
    if (targetTurns) {
      const targetSet = new Set(targetTurns);
      parameters.availableTurns = parameters.availableTurns.filter(t => targetSet.has(t));
    }

    // Minimal VoxContext — no registerTools() needed.
    // The summarizer agent only needs the agent registry (auto-initialized on import)
    // and model config from env vars. No MCP connection required.
    const modelOverrides: Record<string, string> = modelOverride ? { summarizer: modelOverride } : {};
    context = new VoxContext(modelOverrides, `archivist-${gameId}-${playerId}`);

    const contextExceededTurns = await prepareTurnSummaries(parameters, context);

    logger.info(`Telepathist prep complete for player ${playerId} in game ${gameId}`);
    return contextExceededTurns;
  } catch (error) {
    // Log and continue — extraction will proceed with null text fields
    logger.error(`Telepathist prep failed for player ${playerId} in game ${gameId}`, { error });
    return new Set<number>();
  } finally {
    if (parameters?.close) {
      try { await parameters.close(); } catch { /* ignore cleanup errors */ }
    }
    if (context) {
      try { await context.shutdown(); } catch { /* ignore cleanup errors */ }
    }
  }
}
