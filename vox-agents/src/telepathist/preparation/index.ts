/**
 * @module telepathist/preparation
 *
 * Orchestrates turn and phase summary preparation for the telepathist system.
 * Generates structured summaries (situation, situationAbstract, decisions, decisionAbstract, narrative)
 * at both turn and phase granularity.
 */

import { TelepathistParameters } from '../telepathist-parameters.js';
import { VoxContext } from '../../infra/vox-context.js';
import { prepareTurnSummaries } from './turn-preparation.js';
import { preparePhaseSummaries } from './phase-preparation.js';

/**
 * Runs the full preparation pipeline: turn summaries then phase summaries.
 * Called during session initialization ({{{Initialize}}} message).
 */
export async function runPreparation(
  parameters: TelepathistParameters,
  context: VoxContext<TelepathistParameters>
): Promise<void> {
  await prepareTurnSummaries(parameters, context);
  await preparePhaseSummaries(parameters, context);
}
