/** Shared editorial identity metadata and known condition facts. */
import type { NewspaperEvidence } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { ConditionContext } from './conditions.js';

/** Identity metadata supplies labels only for separately observed players. */
export interface EditorialContext {
  receiverTeamId?: number;
  receiverOwnerName?: string;
  playerNames?: Record<string, string>;
  playerTeamIds?: Record<string, number>;
  technologies?: string[];
  technologyHistoryComplete?: boolean;
  civilization?: string;
  technologyIdentities?: Record<string, { type: string; name: string }>;
  majorPlayerIds?: number[];
  standardTurnsPerGameTurn?: number;
}

/** Build known condition facts without inferring technology absence from a partial log. */
export function evidenceConditionContext(
  evidence: NewspaperEvidence,
  context: EditorialContext
): ConditionContext {
  const own = evidence.players.find(
    (player) => player.subjectID === evidence.request.receiverPlayerID
  );
  return {
    values: {
      ...own?.values,
      civilization: context.civilization,
      receiverPlayerId: evidence.request.receiverPlayerID,
      cutoffTurn: evidence.request.cutoffTurn,
    },
    technologies: context.technologies,
    technologyHistoryComplete: context.technologyHistoryComplete,
  };
}
