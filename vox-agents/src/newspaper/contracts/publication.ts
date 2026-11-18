/** Versioned offline editorial memory and audit records, free of runtime imports. */
import { z } from 'zod';
import { newspaperEvidenceRequestSchema, newspaperSourceReferenceSchema } from '../../../../mcp-server/dist/newspaper/evidence.js';
import { diplomacyMemorySchema, diplomacyInferenceSchema } from './diplomacy.js';
import { inlineTextSchema } from './issue.js';
import { triggerRepeatStateSchema, triggerRuleAuditSchema } from './triggers.js';

/** Receiver choices, resolved over catalogue defaults when the run is created. */
export const publicationPreferencesSchema = z.object({
  frequencyStandardTurns: z.number().int().positive().default(5),
  llmEnabled: z.boolean().default(false),
});
export type PublicationPreferences = z.infer<typeof publicationPreferencesSchema>;
/** An article's evidence and editorial identity, retained separately from its immutable prose. */
export const publishedItemRecordSchema = z.object({
  id: z.string(), issueId: z.string(), turn: z.number().int(), tags: z.array(z.string()),
  seriesKeys: z.array(z.string()), templateIds: z.array(z.string()), triggerIds: z.array(z.string()),
  importance: z.number().finite(), headline: inlineTextSchema, evidenceSummary: z.string(),
  sources: z.array(newspaperSourceReferenceSchema), fingerprint: z.string(),
});
export type PublishedItemRecord = z.infer<typeof publishedItemRecordSchema>;
/** Compact history needed by feedback and series continuity. */
export const publishedIssueRecordSchema = z.object({
  issueId: z.string(), turn: z.number().int(), items: z.array(publishedItemRecordSchema),
});
export type PublishedIssueRecord = z.infer<typeof publishedIssueRecordSchema>;
/** Trace of votes and the corpus used to compute their current effect. */
export const feedbackRecordSchema = z.object({
  revision: z.string(), windowItemIds: z.array(z.string()), votes: z.record(z.string(), z.number()),
  tagCounts: z.record(z.string(), z.number()), seriesAdjustments: z.record(z.string(), z.number()),
  tagAdjustments: z.record(z.string(), z.number()),
  coefficients: z.object({ series: z.number(), tag: z.number(), bound: z.number(), window: z.number() }),
});
export type FeedbackRecord = z.infer<typeof feedbackRecordSchema>;
/** Runtime authoring errors kept with the editorial audit. */
const choiceExpressionErrorSchema = z.object({ choice: z.string(), field: z.string(), message: z.string() });
export type ChoiceExpressionError = z.infer<typeof choiceExpressionErrorSchema>;
/** Reproducible choices and supporting evidence for one completed check. */
export const editorialDecisionRecordSchema = z.object({
  checkId: z.string(), cutoffTurn: z.number().int(), configurationId: z.string(),
  configurationSnapshot: z.unknown(), seed: z.string(), editor: z.literal('heuristic'),
  fallbackReason: z.string().optional(), status: z.enum(['published', 'skipped']), reason: z.string().optional(),
  candidateScores: z.array(z.object({ id: z.string(), score: z.number(), selected: z.boolean() })),
  selectedVariants: z.record(z.string(), z.string()), designId: z.string().nullable(),
  layouts: z.record(z.string(), z.string()), evidence: z.array(newspaperSourceReferenceSchema),
  feedback: feedbackRecordSchema,
  diplomacyInference: z.array(diplomacyInferenceSchema),
  triggerAudit: z.array(triggerRuleAuditSchema),
  choiceErrors: z.array(choiceExpressionErrorSchema).min(1).optional(),
  evidenceRequest: newspaperEvidenceRequestSchema,
});
export type EditorialDecisionRecord = z.infer<typeof editorialDecisionRecordSchema>;
/** Importance is dated so each elapsed turn is decayed exactly once. */
export const seriesStateSchema = z.object({
  importance: z.number().finite().nonnegative(), evaluatedTurn: z.number().int(),
  lastPublishedTurn: z.number().int(), lastIssueId: z.string(), lastItemId: z.string(),
});
export type SeriesState = z.infer<typeof seriesStateSchema>;
const publicationSchemaVersion = 6;

/** Current offline memory excludes decisions, which are stored with each completed check. */
export const publicationStateSchema = z.object({
  schemaVersion: z.literal(publicationSchemaVersion), lastCheckTurn: z.number().int().nullable(),
  issues: z.array(publishedIssueRecordSchema), series: z.record(z.string(), seriesStateSchema),
  votes: z.record(z.string(), z.union([z.literal(-1), z.literal(0), z.literal(1)])),
  preferences: publicationPreferencesSchema, previousDesignId: z.string().nullable(),
  diplomacy: diplomacyMemorySchema,
  triggerRepeats: triggerRepeatStateSchema,
});

export type PublicationState = z.infer<typeof publicationStateSchema>;

/** Create an empty receiver checkpoint with resolved publication preferences. */
export function createInitialPublicationState(preferences: Partial<PublicationPreferences> = {}): PublicationState {
  return { schemaVersion: publicationSchemaVersion, lastCheckTurn: null, issues: [], series: {}, votes: {}, diplomacy: { pairs: {} }, triggerRepeats: {},
    preferences: publicationPreferencesSchema.parse(preferences), previousDesignId: null };
}
