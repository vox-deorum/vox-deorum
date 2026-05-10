/**
 * @module telepathist/episode-retriever
 *
 * Non-LLM programmatic agent that retrieves historical episode cases from
 * the archivist's DuckDB archive. Users type a turn number and get formatted
 * episode results. On first load, auto-fetches using the session's initial turn.
 */

import { VoxAgent } from '../infra/vox-agent.js';
import { TelepathistParameters } from './telepathist-parameters.js';
import { EnvoyThread } from '../types/index.js';
import { requestEpisodesFromTelemetry, formatEpisodeResults } from '../utils/prompts/episode-utils.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('EpisodeRetriever');

/**
 * A programmatic (non-LLM) agent that fetches historical episode cases
 * from the archivist archive and formats them as Markdown.
 */
export class EpisodeRetriever extends VoxAgent<TelepathistParameters, EnvoyThread, EnvoyThread> {
  readonly name = 'episode-retriever';
  readonly description = 'Retrieve historical episode cases from the archive for any game turn';
  public tags = ['telepathist'];
  public programmatic = true;

  public async getSystem(): Promise<string> {
    return '';
  }

  public override async handleMessage(
    parameters: TelepathistParameters,
    input: EnvoyThread,
    message: string,
    streamProgress: (text: string) => void
  ): Promise<void> {
    try {
      const isGreeting = message === '{{{Greeting}}}' || message === '{{{Initialize}}}';

      // Determine the target turn
      let turn: number | undefined;

      if (isGreeting) {
        // Use the thread's initial turn or the first available turn
        turn = input.metadata?.turn ?? parameters.availableTurns[0];
      } else {
        // Try to extract a number from the message
        const match = message.match(/\b(\d+)\b/);
        if (match) {
          turn = parseInt(match[1], 10);
        }
      }

      // No turn found — show usage instructions
      if (turn === undefined) {
        const first = parameters.availableTurns[0];
        const last = parameters.availableTurns[parameters.availableTurns.length - 1];
        streamProgress(
          `Please enter a turn number (e.g. '150' or 'turn 150'). Available turns: ${first}\u2013${last}.`
        );
        this.pushAssistantMessage(input, `Please enter a turn number.`);
        return;
      }

      // Snap to closest available turn if exact turn not available
      let resolvedTurn = turn;
      let snapNote = '';
      if (!parameters.availableTurns.includes(turn)) {
        resolvedTurn = this.findClosestTurn(turn, parameters.availableTurns);
        snapNote = `Turn ${turn} not in database — using closest available turn ${resolvedTurn}.\n\n`;
      }

      // Stream greeting header on first load
      if (isGreeting) {
        streamProgress(
          `Episode retriever for **${parameters.leaderName}** of **${parameters.civilizationName}**. ` +
          `Type a turn number to look up similar historical cases.\n\n`
        );
      }

      if (snapNote) {
        streamProgress(snapNote);
      }

      streamProgress(`Fetching episodes for turn ${resolvedTurn}...\n\n`);

      // Fetch episodes from telemetry
      const episodes = await requestEpisodesFromTelemetry(
        parameters.db,
        parameters.telepathistDb,
        resolvedTurn,
        parameters.playerID
      );

      // Format and stream results
      const formatted = formatEpisodeResults(episodes);
      streamProgress(formatted);

      // Update thread state
      this.pushAssistantMessage(input, formatted, resolvedTurn);
      if (input.metadata) {
        input.metadata.turn = resolvedTurn;
      }
    } catch (error) {
      logger.error('Error in episode retriever', { error });
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      streamProgress(`Error retrieving episodes: ${errorMsg}`);
    }
  }

  /** Find the closest turn in the available turns list */
  private findClosestTurn(target: number, availableTurns: number[]): number {
    if (availableTurns.length === 0) return target;

    let closest = availableTurns[0];
    let minDiff = Math.abs(target - closest);

    for (const t of availableTurns) {
      const diff = Math.abs(target - t);
      if (diff < minDiff) {
        closest = t;
        minDiff = diff;
      }
    }

    return closest;
  }

  /** Push an assistant message onto the thread */
  private pushAssistantMessage(input: EnvoyThread, text: string, turn?: number): void {
    input.messages.push({
      message: { role: 'assistant', content: text },
      metadata: {
        datetime: new Date(),
        turn: turn ?? input.metadata?.turn ?? 0
      }
    });
  }
}
