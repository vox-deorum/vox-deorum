/**
 * @module telepathist/preparation/phase-preparation
 *
 * Generates phase summaries by grouping turn summaries into ~10-turn phases
 * and calling the Summarizer with structured output for each unsummarized phase.
 */

import pLimit from 'p-limit';
import { TelepathistParameters } from '../telepathist-parameters.js';
import { VoxContext } from '../../infra/vox-context.js';
import { SummarizerInput, summarizerModelName } from '../summarizer.js';
import { phaseSummarySchema, buildPhaseSummaryInstruction } from './instructions.js';
import { generateSummary } from './summary-generation.js';

/** Size of each phase in turns for summarization */
const phaseSize = 10;

/**
 * Generates phase summaries from turn summaries, ~10 turns per phase.
 * For each phase: combines turn situation + decisions texts, calls the summarizer
 * with a structured instruction, and stores the result.
 */
export async function preparePhaseSummaries(
  parameters: TelepathistParameters,
  context: VoxContext<TelepathistParameters>
): Promise<void> {
  const model = summarizerModelName(context.modelOverrides);
  const logger = context.logger.child({ gameID: parameters.gameID, playerID: parameters.playerID, civ: parameters.civilizationName, model });

  const existingPhases = await parameters.telepathistDb
    .selectFrom('phase_summaries')
    .select(['fromTurn', 'toTurn'])
    .execute();
  const existingPhaseKeys = new Set(existingPhases.map(p => `${p.fromTurn}-${p.toTurn}`));

  const turnSummaries = await parameters.telepathistDb
    .selectFrom('turn_summaries')
    .selectAll()
    .orderBy('turn', 'asc')
    .execute();

  if (turnSummaries.length === 0) return;

  // Group into phases of ~phaseSize turns
  const phases: { fromTurn: number; toTurn: number; summaries: typeof turnSummaries }[] = [];
  for (let i = 0; i < turnSummaries.length; i += phaseSize) {
    const chunk = turnSummaries.slice(i, i + phaseSize);
    phases.push({
      fromTurn: chunk[0].turn,
      toTurn: chunk[chunk.length - 1].turn,
      summaries: chunk
    });
  }

  const phasesToSummarize = phases.filter(p => !existingPhaseKeys.has(`${p.fromTurn}-${p.toTurn}`));
  const limit = pLimit(5);

  // Capture the caller's progress sink once before the fan-out; carried into each phase's root.
  const streamProgress = context.streamProgress;

  await Promise.all(
    phasesToSummarize.map(phase =>
      limit(() =>
        // Each concurrent phase runs in its own root with `turn` overridden to the phase's last
        // turn, plus its own signal and token sink, composing over the base parameters.
        context.withRun({ overrides: { turn: phase.toTurn }, streamProgress }, async (run) => {
        const parameters = run.parameters;
        context.streamProgress?.(`Summarizing phase: turns ${phase.fromTurn}–${phase.toTurn}...`);

        try {
          // Format turn situation + decisions as combined input
          const formattedSummaries = phase.summaries
            .map(s => `## Turn ${s.turn}\n### Situation\n${s.situation}\n### Decisions\n${s.decisions}`)
            .join('\n\n');

          const [instruction, reminder] = buildPhaseSummaryInstruction(phase.fromTurn, phase.toTurn);
          const input: SummarizerInput = {
            text: `# Turn Summaries: Turns ${phase.fromTurn} to ${phase.toTurn}\n${formattedSummaries}`,
            instruction,
            reminder
          };
          const summary = await generateSummary(context, input, phaseSummarySchema, logger, `phase-${phase.fromTurn}-${phase.toTurn}`);
          if (!summary) {
            logger.warn(`Phase ${phase.fromTurn}-${phase.toTurn} exceeded the summarizer context window, skipping`);
            return;
          }

          context.streamProgress?.(`Phase ${phase.fromTurn}–${phase.toTurn}: ${summary.narrative}`);
          await parameters.telepathistDb
            .insertInto('phase_summaries')
            .values({
              fromTurn: phase.fromTurn,
              toTurn: phase.toTurn,
              situation: summary.situation,
              situationAbstract: summary.situationabstract,
              decisions: summary.decisions,
              decisionAbstract: summary.decisionabstract,
              narrative: summary.narrative,
              model,
              createdAt: Date.now()
            })
            .execute();
        } catch (e) {
          logger.error(`Failed to summarize phase ${phase.fromTurn}-${phase.toTurn}`, { error: e });
        }
        })
      )
    )
  );
}
