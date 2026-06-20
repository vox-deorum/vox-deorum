/**
 * @module telepathist/talkative-telepathist
 *
 * First concrete Telepathist agent: an analyst who has "read the mind"
 * of the AI player and can discuss the game's history, decisions, and strategies
 * from the telemetry record.
 */

import { Telepathist } from './telepathist.js';
import { TelepathistParameters } from './telepathist-parameters.js';
import { EnvoyThread } from '../types/index.js';
import { VoxContext } from '../infra/vox-context.js';

/**
 * A talkative telepathist that discusses game history and AI decisions.
 * Uses database-backed tools to answer questions about what happened,
 * what decisions were made, and why.
 */
export class TalkativeTelepathist extends Telepathist {
  readonly name = 'talkative-telepathist';
  readonly description = 'An analyst who can discuss the player\'s game history, decisions, and strategies from the telemetry record';
  public tags = ['telepathist'];

  public async getSystem(
    params: TelepathistParameters,
    input: EnvoyThread,
    _context: VoxContext<TelepathistParameters>
  ): Promise<string> {
    const { name, leader } = this.getSelfIdentity(input);
    const sections = [
      `You are a senior analyst who specializes on ${leader} of ${name}, a player in a Civilization V game with Vox Populi mod.
You have access to the complete historical record: every world state it observed and every decision the leader made.`,

      `# Your Role
- You provide insights through digging into the historical records.
- You have access to the game state, strategic decisions, and the player's internal reasoning at every turn.
- The history happened in a generated world, and the geography had nothing to do with the real Earth.
- You can evaluate whether decisions were good or bad given what happened before and after it.`,

      `# Your Expectations
- Keep responses conversational, concise, focused, and grounded in information acquired from tool calls.
- When multiple sources are in conflict, try to narrow down the range to acquire more accurate information.
- Identify turning points, mistakes, and good decisions.
- Acknowledge uncertainty when the data doesn't clearly support a conclusion.
- Always cite specifics: turn number, civilization name, city name, etc.`,
    ];

    if (!this.isSpecialMode(input)) {
      sections.push(`# Available Tools
- Always launch inquiry beyond the game summary: it serve as the anchor point, NOT sources of truth.
- Only answer after collecting sufficient data or, when no more data is available, make an educated guess (toned accordingly).
- **get-situation**: Get world state for specific turns. Returns pre-generated summaries; use Detailed mode for ONE turn to get full game data (players, cities, military, etc.)
- **get-decision**: Get player decisions and reasoning. Returns pre-generated summaries; use Detailed mode for ONE turn to get full decision data with agents, options, and reasoning
- **get-conversation-log**: Use it to get the full internal conversation for a turn for deep dives into exact reasoning`);
    }

    return sections.join('\n\n').trim();
  }

  protected getHint(parameters: TelepathistParameters, input: EnvoyThread): string {
    const { name, leader } = this.getSelfIdentity(input);
    return `**HINT**: You are analyzing ${leader} of ${name}'s game. Data spans turns ${parameters.availableTurns[0]} to ${parameters.availableTurns[parameters.availableTurns.length - 1]}. If you decide to call tools, follow the EXACT format and generate JSON output.`;
  }

  protected override getSpecialMessages(): Record<string, string> {
    return {
      '{{{Initialize}}}': 'The session is starting. Introduce yourself as a analyst who has studied the record and invite the user to ask questions.',
      '{{{Greeting}}}': 'Send a brief greeting acknowledging the history you\'re analyzing. Mention the civilization and invite questions.'
    };
  }
}
