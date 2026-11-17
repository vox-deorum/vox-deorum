/** Derive bounded developments only from permitted, dated observations. */
import type { NewspaperEvidence, NewspaperSourceReference } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { EditorialConfig } from './config.js';
import { evaluateCondition, type ConditionContext } from './conditions.js';
import { detectDevelopments } from './developments.js';
import { detectWarAndPeace, diplomacyDetectors } from './war-peace.js';

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
/** One measured development, with placeholders and traceable source rows. */
export interface DetectedTrigger {
  id: string; definitionId: string; subject: string; seriesKeys: string[]; conflictKeys?: string[];
  period: { from: number; to: number }; importance: number; urgent: boolean; tags: string[];
  values: Record<string, string | number>; sources: NewspaperSourceReference[]; summary: string; fingerprint: string;
}

/** Build known condition facts without inferring technology absence from a partial log. */
export function evidenceConditionContext(evidence: NewspaperEvidence, context: EditorialContext): ConditionContext {
  const own = evidence.players.find(player => player.subjectID === evidence.request.receiverPlayerID);
  return { values: { ...own?.values, civilization: context.civilization, receiverPlayerId: evidence.request.receiverPlayerID,
    cutoffTurn: evidence.request.cutoffTurn }, technologies: context.technologies,
    technologyHistoryComplete: context.technologyHistoryComplete };
}

/** Match configured developments and already reconstructed diplomatic incidents. */
export function detectTriggers(evidence: NewspaperEvidence, config: EditorialConfig, context: EditorialContext = {}, diplomacy?: DetectedTrigger[]): DetectedTrigger[] {
  const result: DetectedTrigger[] = [...(diplomacy ?? detectWarAndPeace(evidence, config, context).triggers)];
  const cutoff = evidence.request.cutoffTurn;
  const conditions = evidenceConditionContext(evidence, context);
  for (const definition of config.triggers) {
    if (definition.enabled === false || diplomacyDetectors.includes(definition.detector) || evaluateCondition(definition.condition, conditions) !== true) continue;
    for (const draft of detectDevelopments(evidence, definition, context)) {
      if (draft.magnitude < definition.threshold || !draft.sources.length || draft.sources.some(source => source.turn > cutoff)) continue;
      const id = `${definition.id}/${draft.subject}/${draft.sources.map(source => `${source.table}:${source.id}`).join(',')}`;
      result.push({ id, definitionId: definition.id, subject: draft.subject, seriesKeys: draft.keys,
        period: { from: Math.min(...draft.sources.map(source => source.turn)), to: Math.max(...draft.sources.map(source => source.turn)) },
        importance: Math.min(config.defaults.importanceMax, config.defaults.importanceMax * draft.magnitude / definition.scale),
        urgent: false, tags: draft.tags, values: draft.values, sources: draft.sources, summary: draft.summary, fingerprint: draft.fingerprint ?? id });
    }
  }
  return result;
}
