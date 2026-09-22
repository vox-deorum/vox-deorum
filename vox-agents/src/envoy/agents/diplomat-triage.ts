/** Evaluator questions, compact state, and routing policy for diplomat triage. */

import type {
  Experimental_EvaluationQuestion as EvaluationQuestion,
  Experimental_EvaluationResult as EvaluationResult,
} from 'ai';
import type { StrategistParameters } from '../../strategist/strategy-parameters.js';
import type { EnvoyThread } from '../../types/index.js';
import type { TriageDecision } from '../../infra/vox-agent.js';
import type { DealReduction } from '../../utils/diplomacy/deal/deal-reduce.js';

/** The diplomat's typed intent and stakes questions. */
export const diplomatTriageQuestions = {
  intent: {
    type: 'choice',
    instructions: 'What is the main intent of the current diplomatic exchange?',
    criteria: {
      deal: 'A trade, treaty, concession, or other negotiated agreement',
      threat: 'A warning, ultimatum, coercive demand, or hostile signal',
      request: 'A request for information, support, action, or a diplomatic response',
      'small talk': 'A greeting, pleasantry, or low consequence conversation',
    },
  },
  stakes: {
    type: 'score',
    instructions: 'How consequential is this exchange for the civilization?',
    criteria: ['trivial', 'limited', 'significant', 'critical'],
  },
} satisfies Record<string, EvaluationQuestion>;

export type DiplomatTriageAnswers = EvaluationResult<typeof diplomatTriageQuestions>['answers'];

/** Route diplomat intent and stakes to a model tier. */
export function routeDiplomatTriage(answers: DiplomatTriageAnswers): TriageDecision {
  if (answers.intent.choice === 'small talk') return { tier: 'small' };
  if ((answers.intent.choice === 'deal' || answers.intent.choice === 'threat') && answers.stakes.score >= 2) {
    return { tier: 'large' };
  }
  return { tier: 'default' };
}

/** Build bounded diplomat state from recent messages and the authoritative deal reduction. */
export function buildDiplomatTriageState(
  parameters: StrategistParameters,
  input: EnvoyThread,
  reduction: DealReduction,
) {
  return {
    turn: parameters.turn,
    voicedPlayerID: input.agent,
    messages: input.messages.slice(-6).map(({ message, metadata }) => ({
      role: message.role,
      content: message.content,
      turn: metadata.turn,
    })),
    openProposal: reduction.status === 'open' ? reduction.active : undefined,
  };
}
