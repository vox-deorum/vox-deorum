import { GetSituationTool, situationCategories } from '../../telepathist/tools/get-situation.js';
import type { TelepathistParameters } from '../../telepathist/telepathist-parameters.js';

const storyCategories = situationCategories.filter(category => category !== 'options');
const situationTool = new GetSituationTool();

/** Reconstruct the player's game state for one turn, or return null if there is none. */
export async function readStoryMaterial(params: TelepathistParameters, turn: number): Promise<string | null> {
  const { text, hasGameState } = await situationTool.readDetailedTurn(turn, params, storyCategories);
  return hasGameState ? text : null;
}
