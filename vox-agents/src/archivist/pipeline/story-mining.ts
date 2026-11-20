import { config } from '../../agents/config/load.js';
import { formatModelReference } from '../../agents/models/model-reference.js';
import { getModelConfig } from '../../agents/models/models.js';
import { ensureModelsResolved, selectModelReference } from '../../agents/models/resolution.js';
import { reloadRootPrompts } from '../../agents/prompts/prompt-files.js';
import { VoxContext } from '../../agents/runtime/vox-context.js';
import { createTelepathistParameters, type TelepathistParameters } from '../../telepathist/telepathist-parameters.js';
import { createLogger } from '../../utils/logger.js';
import { storyScoutName } from '../story-scout.js';
import type { ArchiveEntry, StoryScoutOutput } from '../types.js';
import { generateEmbeddings } from './embeddings.js';
import { readStoryMaterial } from './story-material.js';
import { sampleStoryTurns } from './story-sampler.js';
import type { EpisodeWriter } from './writer.js';

export const defaultStorySeed = '42';

interface StoryMiningOptions {
  turnCount: number;
  seed: string;
  force: boolean;
  skipEmbeddings: boolean;
}

const logger = createLogger('Archivist:Stories');

interface StoryMiningStats {
  errors: number;
  samplesSaved: number;
}

export type StoryMiner = (entry: ArchiveEntry, writer: EpisodeWriter) => Promise<StoryMiningStats>;

/** Prepare a miner for one resolved model. */
export async function createStoryMiner(options: StoryMiningOptions, modelOverride?: string): Promise<StoryMiner> {
  const reference = modelOverride ?? selectModelReference(storyScoutName);
  await ensureModelsResolved([reference]);
  const scoutModel = getModelConfig(reference);
  const model = formatModelReference(scoutModel);
  reloadRootPrompts();

  // generateEmbeddings resolves the alias before its error handling and would fall back to a chat model.
  const hasEmbedder = config.llms.embedder !== undefined;
  const embedPitches = !options.skipEmbeddings && hasEmbedder;
  if (!options.skipEmbeddings && !hasEmbedder) {
    logger.warn('No embedder is configured; story pitches will be stored without embeddings');
  }

  /** Mine each LLM player in this game. */
  return async function mineGameStories(entry, writer) {
    const stats: StoryMiningStats = { errors: 0, samplesSaved: 0 };
    for (const player of entry.players) {
      const playerLogger = logger.child({ gameId: entry.gameId, playerId: player.playerId, model });
      try {
        const context = new VoxContext<TelepathistParameters>(
          { [storyScoutName]: scoutModel }, `archivist-stories-${entry.gameId}-${player.playerId}`
        );
        try {
          const params = await createTelepathistParameters(player.telemetryDbPath, {
            gameID: entry.gameId, playerID: player.playerId,
          });
          context.setBaseParameters(params);
          await minePlayerStories(writer, model, options, embedPitches, context, params, playerLogger, stats);
        } finally {
          await context.shutdown();
        }
      } catch (error) {
        playerLogger.error('Story mining failed for player', { error });
        stats.errors++;
      }
    }
    return stats;
  };
}

/** Read and save the sampled turns for one player, skipping unusable or completed samples. */
async function minePlayerStories(
  writer: EpisodeWriter,
  model: string,
  { turnCount, seed, force }: StoryMiningOptions,
  embedPitches: boolean,
  context: VoxContext<TelepathistParameters>,
  params: TelepathistParameters,
  playerLogger: typeof logger,
  stats: StoryMiningStats,
): Promise<void> {
  const { gameID: gameId, playerID: playerId } = params;
  const turns = sampleStoryTurns(params.availableTurns, gameId, playerId, seed, turnCount);
  const completed = force ? undefined : await writer.getStorySampleTurns(gameId, playerId, model);
  for (const turn of turns) {
    if (completed?.has(turn)) continue;
    try {
      const episode = await writer.getEpisodeIdentity(gameId, playerId, turn);
      if (!episode) {
        playerLogger.warn('Skipping story sample without a Phase A episode', { turn });
        continue;
      }
      const material = await readStoryMaterial(params, turn);
      if (material === null) {
        playerLogger.warn('Skipping story sample without recorded game state', { turn });
        continue;
      }

      let contextExceeded = false;
      const output = await context.withRun({ overrides: { turn } }, () =>
        context.execute(storyScoutName, { civilization: episode.civilization, material }, undefined, undefined,
          () => { contextExceeded = true; }, { throwOnError: true })
      ) as StoryScoutOutput | undefined;
      if (contextExceeded) {
        playerLogger.warn('Skipping story sample that exceeds the context window', { turn });
        continue;
      }
      if (!output) throw new Error('Story scout returned no pitches');

      const embeddings = embedPitches
        ? await generateEmbeddings(output.pitches.map(({ headline, pitch }) => `${headline}\n${pitch}`))
        : [];
      // The episode embedder returns nulls on failure; a failed story sample must leave its old pitches intact.
      if (embeddings.some(embedding => !embedding)) throw new Error('Could not embed all story pitches');

      await writer.writeStoryPitches({ gameId, playerId, turn, model }, episode, output.pitches.map((pitch, index) => ({
        ...pitch, embedding: embeddings[index] ?? null,
      })), force);
      stats.samplesSaved++;
      playerLogger.info('Saved story pitches', { turn, pitches: output.pitches.length });
    } catch (error) {
      stats.errors++;
      playerLogger.error('Story sample failed', { turn, error });
    }
  }
}
