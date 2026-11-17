/** Derive bounded developments only from permitted, dated observations. */
import type {
  NewspaperEvidence,
  NewspaperSourceReference,
} from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { EditorialConfig } from './config/schema.js';
import { evaluateCondition } from './shared/conditions.js';
import { evidenceConditionContext, type EditorialContext } from './shared/context.js';
import { detectDevelopments } from './developments/detect.js';
import { detectWarAndPeace, diplomacyDetectors } from './diplomacy/war-peace.js';

/** One measured development, with placeholders and traceable source rows. */
export interface DetectedTrigger {
  id: string;
  definitionId: string;
  subject: string;
  seriesKeys: string[];
  conflictKeys?: string[];
  period: { from: number; to: number };
  importance: number;
  urgent: boolean;
  tags: string[];
  values: Record<string, string | number>;
  sources: NewspaperSourceReference[];
  summary: string;
  fingerprint: string;
}

/** Match configured developments and already reconstructed diplomatic incidents. */
export function detectTriggers(
  evidence: NewspaperEvidence,
  config: EditorialConfig,
  context: EditorialContext = {},
  diplomacy?: DetectedTrigger[]
): DetectedTrigger[] {
  const result: DetectedTrigger[] = [
    ...(diplomacy ?? detectWarAndPeace(evidence, config, context).triggers),
  ];
  const cutoff = evidence.request.cutoffTurn;
  const conditions = evidenceConditionContext(evidence, context);
  for (const definition of config.triggers) {
    if (
      definition.enabled === false ||
      diplomacyDetectors.includes(definition.detector) ||
      evaluateCondition(definition.condition, conditions) !== true
    )
      continue;
    for (const draft of detectDevelopments(evidence, definition, context)) {
      if (
        draft.magnitude < definition.threshold ||
        !draft.sources.length ||
        draft.sources.some((source) => source.turn > cutoff)
      )
        continue;
      const id = `${definition.id}/${draft.subject}/${draft.sources.map((source) => `${source.table}:${source.id}`).join(',')}`;
      result.push({
        id,
        definitionId: definition.id,
        subject: draft.subject,
        seriesKeys: draft.keys,
        period: {
          from: Math.min(...draft.sources.map((source) => source.turn)),
          to: Math.max(...draft.sources.map((source) => source.turn)),
        },
        importance: Math.min(
          config.defaults.importanceMax,
          (config.defaults.importanceMax * draft.magnitude) / definition.scale
        ),
        urgent: false,
        tags: draft.tags,
        values: draft.values,
        sources: draft.sources,
        summary: draft.summary,
        fingerprint: draft.fingerprint ?? id,
      });
    }
  }
  return result;
}
