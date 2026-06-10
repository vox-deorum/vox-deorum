/**
 * @module utils/prompts/episode-utils
 *
 * Composable functions for episode retrieval from both live game state and telemetry.
 * Provides three main capabilities:
 * - requestEpisodes: retrieves similar historical episodes during live strategist play
 * - requestEpisodesFromTelemetry: retrieves episodes from post-game telemetry data
 * - formatEpisodeResults: formats episode results as markdown for LLM consumption
 */

import { Kysely } from 'kysely';
import { createLogger } from '../logger.js';
import { buildLiveGameStateVector } from '../../archivist/pipeline/game-state-vector.js';
import { parseDiplomatics, findEpisodes } from '../../archivist/index.js';
import type { EpisodeQuery, EpisodeResult } from '../../archivist/index.js';
import type { GameState, StrategistParameters } from '../../strategist/strategy-parameters.js';
import type { PlayersReport } from '../../../../mcp-server/dist/tools/knowledge/get-players.js';
import type { CitiesReport } from '../../../../mcp-server/dist/tools/knowledge/get-cities.js';
import type { VictoryProgressReport } from '../../../../mcp-server/dist/tools/knowledge/get-victory-progress.js';
import type { TelemetryDatabase } from '../telemetry/schema.js';
import type { TelepathistDatabase } from '../../telepathist/telepathist-parameters.js';

const logger = createLogger('EpisodeUtils');

/** Build an EpisodeQuery from a players report, player entry, and vectors. */
function buildEpisodeQuery(
  players: PlayersReport,
  playerEntry: Exclude<PlayersReport[string], string>,
  vectors: { gameStateVector: number[]; neighborVector: number[] },
  grandStrategy: string | null,
  situationAbstract?: string
): EpisodeQuery {
  const majorCivNames = new Set<string>();
  for (const entry of Object.values(players)) {
    if (typeof entry === 'string') continue;
    if (entry.IsMajor) majorCivNames.add(entry.Civilization);
  }

  const relationships = (playerEntry.Relationships as Record<string, string | string[]>) ?? null;
  const diplomatics = parseDiplomatics(relationships, majorCivNames);

  return {
    gameStateVector: vectors.gameStateVector,
    neighborVector: vectors.neighborVector,
    situationAbstract,
    era: (playerEntry.Era as string) ?? 'Ancient Era',
    civilization: playerEntry.Civilization,
    grandStrategy,
    activeWars: diplomatics.activeWars,
    friends: diplomatics.friends,
    defensivePacts: diplomatics.defensivePacts,
    truces: diplomatics.truces,
    denouncements: diplomatics.denouncements,
  };
}

/**
 * Retrieve similar historical episodes for a live strategist session.
 * Builds game-state and neighbor vectors from the current GameState, then
 * queries the archivist for matching episodes with diplomatic context.
 *
 * @param state - Current game state snapshot
 * @param parameters - Strategist session parameters (playerID, gameID, etc.)
 * @param situationAbstract - Optional situationAbstract text for semantic similarity matching
 * @returns Array of matching episode results, or empty array on failure
 */
export async function requestEpisodes(
  state: GameState,
  parameters: StrategistParameters,
  situationAbstract?: string
): Promise<EpisodeResult[]> {
  try {
    // Build game-state and neighbor vectors from live state
    // Count total major civs from the players report
    let totalMajors: number | undefined;
    if (state.players) {
      totalMajors = 0;
      for (const entry of Object.values(state.players)) {
        if (typeof entry !== 'string' && entry.IsMajor) totalMajors++;
      }
    }

    const vectors = buildLiveGameStateVector(state, parameters.playerID, parameters.gameID, {
      totalMajors,
    });

    if (!vectors) return [];

    // Get the player entry
    const playerEntry = state.players?.[parameters.playerID.toString()];
    if (!playerEntry || typeof playerEntry === 'string') return [];

    const query = buildEpisodeQuery(
      state.players!,
      playerEntry,
      vectors,
      parameters.workingMemory?.grandStrategy ?? null,
      situationAbstract
    );

    return await findEpisodes(query);
  } catch (error) {
    logger.error('Failed to request episodes', { error });
    return [];
  }
}

/**
 * Retrieve similar historical episodes from post-game telemetry data.
 * Reconstructs game state from recorded tool output spans, then queries
 * the archivist for matching episodes.
 *
 * @param telemetryDb - Kysely connection to the telemetry database
 * @param telepathistDb - Optional Kysely connection to the telepathist database (for abstracts)
 * @param turn - The turn number to retrieve episodes for
 * @param playerId - The player ID to build vectors for
 * @returns Array of matching episode results, or empty array on failure
 */
export async function requestEpisodesFromTelemetry(
  telemetryDb: Kysely<TelemetryDatabase>,
  telepathistDb: Kysely<TelepathistDatabase> | null,
  turn: number,
  playerId: number
): Promise<EpisodeResult[]> {
  try {
    // Query latest tool output spans at the given turn
    const toolSpans = await telemetryDb
      .selectFrom('spans')
      .select(['name', 'attributes'])
      .where('turn', '=', turn)
      .where('name', 'in', ['mcp-tool.get-players', 'mcp-tool.get-cities', 'mcp-tool.get-victory-progress'])
      .where('statusCode', '!=', 2)
      .orderBy('startTime', 'desc')
      .execute();

    // Take the latest span per tool name and parse tool.output from attributes
    const toolOutputs = new Map<string, any>();
    for (const span of toolSpans) {
      if (toolOutputs.has(span.name)) continue;
      const attrs = typeof span.attributes === 'string' ? JSON.parse(span.attributes) : span.attributes;
      if (attrs?.['tool.output']) {
        const output = typeof attrs['tool.output'] === 'string'
          ? JSON.parse(attrs['tool.output'])
          : attrs['tool.output'];
        toolOutputs.set(span.name, output);
      }
    }

    // Extract reports from tool outputs
    const players = toolOutputs.get('mcp-tool.get-players') as PlayersReport | undefined;
    const cities = toolOutputs.get('mcp-tool.get-cities') as CitiesReport | undefined;
    const victory = toolOutputs.get('mcp-tool.get-victory-progress') as VictoryProgressReport | undefined;

    if (!players) return [];

    // Construct a partial GameState from the extracted reports
    const gameState: GameState = { turn, players, cities, victory, reports: {} };

    // Build game-state and neighbor vectors
    const vectors = buildLiveGameStateVector(gameState, playerId, 'telemetry');
    if (!vectors) return [];

    // Read situationAbstract from telepathist DB if available
    let situationAbstract: string | undefined;
    if (telepathistDb) {
      try {
        const row = await telepathistDb
          .selectFrom('turn_summaries')
          .select('situationAbstract')
          .where('turn', '=', turn)
          .executeTakeFirst();
        situationAbstract = row?.situationAbstract ?? undefined;
      } catch { /* ignore - table may not exist */ }
    }

    // Get player entry and build query
    const playerEntry = players[playerId.toString()];
    if (!playerEntry || typeof playerEntry === 'string') return [];

    const query = buildEpisodeQuery(players, playerEntry, vectors, null, situationAbstract);

    return await findEpisodes(query);
  } catch (error) {
    logger.error('Failed to request episodes from telemetry', error);
    return [];
  }
}

/**
 * Format episode results as structured markdown for LLM consumption.
 * Includes similarity scores, indicators, and outcome trajectories.
 *
 * @param results - Array of episode results to format
 * @returns Markdown-formatted string describing the episodes
 */
export function formatEpisodeResults(results: EpisodeResult[]): string {
  if (results.length === 0) return 'No similar historical episodes found.';

  const sections = results.map((ep, i) => {
    const header = `## Episode ${i + 1}: ${ep.civilization} (${ep.era}, Turn ${ep.turn})`;
    const meta = `- **Similarity**: ${(ep.similarity * 100).toFixed(1)}%`;

    const parts = [header, meta];

    // Indicators
    const ind = ep.indicators;
    const indParts: string[] = [];
    if (ind.sciencePerPop != null) indParts.push(`sciencePerPop: ${ind.sciencePerPop.toFixed(1)}`);
    if (ind.culturePerPop != null) indParts.push(`culturePerPop: ${ind.culturePerPop.toFixed(1)}`);
    if (ind.productionPerPop != null) indParts.push(`productionPerPop: ${ind.productionPerPop.toFixed(1)}`);
    if (ind.goldPerPop != null) indParts.push(`goldPerPop: ${ind.goldPerPop.toFixed(1)}`);
    if (ind.tourismShare != null) indParts.push(`tourismShare: ${ind.tourismShare.toFixed(1)}x`);
    if (ind.militaryShare != null) indParts.push(`militaryShare: ${ind.militaryShare.toFixed(1)}x`);
    if (ind.populationShare != null) indParts.push(`populationShare: ${ind.populationShare.toFixed(1)}x`);
    if (ind.citiesShare != null) indParts.push(`citiesShare: ${ind.citiesShare.toFixed(1)}x`);
    if (ind.minorAlliesShare != null) indParts.push(`minorAlliesShare: ${ind.minorAlliesShare.toFixed(1)}x`);
    if (ind.religionPercentage != null) indParts.push(`religionShare: ${(ind.religionPercentage * 100).toFixed(0)}%`);
    if (ind.warWeariness != null) indParts.push(`warWeariness: ${ind.warWeariness.toFixed(0)}%`);
    if (ind.activeWars != null) indParts.push(`Wars: ${ind.activeWars}`);
    if (ind.truces != null) indParts.push(`Truces: ${ind.truces}`);
    if (indParts.length > 0) parts.push(`- **Indicators**: ${indParts.join(' | ')}`);

    // Situations
    if (ep.situationAbstract) parts.push(`\n### Situation\n${ep.situationAbstract.replaceAll("\n", "")}`);
    if (ep.decisions) parts.push(`\n### Decisions\n${ep.decisions}`);

    // Outcomes
    if (ep.outcomes.length > 0) {
      for (const out of ep.outcomes) {
        const deltas: string[] = [];
        for (const [key, val] of Object.entries(out.deltas)) {
          if (val && val !== '0%') deltas.push(`${key}: ${val}`);
        }
        const deltaStr = deltas.length > 0 ? deltas.join(', ') : 'no change';
        const turnLabel = `+${out.horizonTurns} Turns`;
        parts.push(`\n### Outcome at ${turnLabel}`);
        parts.push(`- **Delta**: ${deltaStr}`);
        if (out.situationAbstract) parts.push(`\n- **Situation**: ${out.situationAbstract.replaceAll("\n", "")}`);
        if (out.decisionAbstract) parts.push(`\n- **Further Decisions**: ${out.decisionAbstract.replaceAll("\n", "")}`);
      }
    }

    // Final outcome
    if (ep.victoryType) {
        parts.push(`\n### Long-term outcome`);
        if (ep.isWinner) {
          parts.push(`${ep.civilization} achieved **${ep.victoryType}** victory.`);
        } else {
          parts.push(`Another civilization achieved a **${ep.victoryType}** victory.`);
        }
    }

    return parts.join('\n');
  });

  return sections.join('\n\n---\n\n');
}
