/** Versioned offline editorial memory and audit records, free of runtime imports. */
import { z } from 'zod';
import { newspaperEvidenceRequestSchema, newspaperSourceReferenceSchema } from '../../../../mcp-server/dist/newspaper/evidence.js';
import { diplomacyMemorySchema, diplomacyInferenceSchema } from './diplomacy.js';
import { inlineTextSchema } from './issue.js';
import { variantStyleSchema } from './style.js';
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
  ruleIds: z.array(z.string()).optional(), subject: z.string().optional(),
  ruleSubjects: z.array(z.object({ ruleId: z.string(), subject: z.string() })).optional(),
  importance: z.number().finite(), headline: inlineTextSchema, evidenceSummary: z.string(),
  sources: z.array(newspaperSourceReferenceSchema), fingerprint: z.string(),
  coveredFingerprints: z.array(z.string()).optional(),
});
export type PublishedItemRecord = z.infer<typeof publishedItemRecordSchema>;
/** Compact history needed by feedback and series continuity. */
export const publishedIssueRecordSchema = z.object({
  issueId: z.string(), turn: z.number().int(), items: z.array(publishedItemRecordSchema),
  designId: z.string().min(1),
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
/** Press run history and the weights available for the design draw. */
const designSelectionSchema = z.object({
  previousId: z.string().nullable(),
  priorRunLength: z.number().int().min(0).max(6),
  reason: z.enum(['opening', 'protected', 'weighted', 'run-limit', 'weak-incumbent', 'ineligible-incumbent', 'no-eligible']),
  candidates: z.array(z.object({
    id: z.string(), rawWeight: z.number().positive(), drawWeight: z.number().nonnegative(),
  })),
});
export type DesignSelection = z.infer<typeof designSelectionSchema>;
/** Reproducible choices and supporting evidence for one completed check. */
export const editorialDecisionRecordSchema = z.object({
  checkId: z.string(), cutoffTurn: z.number().int(), configurationId: z.string(),
  configurationSnapshot: z.unknown(), seed: z.string(), editor: z.literal('heuristic'),
  fallbackReason: z.string().optional(), status: z.enum(['published', 'skipped']), reason: z.string().optional(),
  candidateScores: z.array(z.object({ id: z.string(), score: z.number(), selected: z.boolean(), mergedInto: z.string().optional() })),
  selectedVariants: z.record(z.string(), z.string()), designId: z.string().nullable(),
  mastheadRuleId: z.string().optional(),
  designSelection: designSelectionSchema.optional(),
  selectedStyles: z.record(z.string(), variantStyleSchema).optional(),
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
const publicationSchemaVersion = 7;

/** Current receiver memory kept in the latest checkpoint. Editions and their article evidence live in the archive. */
export const publicationStateSchema = z.object({
  schemaVersion: z.literal(publicationSchemaVersion), lastCheckTurn: z.number().int().nullable(),
  /** Last covered turn, or the turn before a new replay begins. */
  reportingThroughTurn: z.number().int().nullable(),
  issues: z.array(publishedIssueRecordSchema), series: z.record(z.string(), seriesStateSchema),
  votes: z.record(z.string(), z.union([z.literal(-1), z.literal(0), z.literal(1)])),
  preferences: publicationPreferencesSchema,
  diplomacy: diplomacyMemorySchema,
  triggerRepeats: triggerRepeatStateSchema,
}).strict();

export type PublicationState = z.infer<typeof publicationStateSchema>;

/** Create an empty receiver checkpoint with resolved publication preferences. */
export function createInitialPublicationState(preferences: Partial<PublicationPreferences> = {}): PublicationState {
  return { schemaVersion: publicationSchemaVersion, lastCheckTurn: null, reportingThroughTurn: null,
    issues: [], series: {}, votes: {}, diplomacy: { pairs: {} }, triggerRepeats: {},
    preferences: publicationPreferencesSchema.parse(preferences) };
}
