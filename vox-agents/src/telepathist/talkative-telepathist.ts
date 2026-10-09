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
import { renderSystemPrompt } from '../utils/prompts/prompt-files.js';

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
    _params: TelepathistParameters,
    input: EnvoyThread,
    context: VoxContext<TelepathistParameters>
  ): Promise<string> {
    const { name, leader } = this.getSelfIdentity(input);
    return renderSystemPrompt(context, 'talkative-telepathist', {
      leader,
      civilization: name,
      special: this.isSpecialMode(input),
    });
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
