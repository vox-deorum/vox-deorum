import { z } from 'zod';
import { newspaperEvidenceSchema } from '../../../../mcp-server/dist/newspaper/evidence.js';
import { newspaperArchiveScopeSchema } from '../../../../mcp-server/dist/newspaper/protocol.js';
import { publicationPreferencesSchema, editorialDecisionRecordSchema } from './publication.js';
import { issueDocumentSchema } from './issue.js';

/** The optional recording used to prefill a new form. */
export const latestRecordingSchema = z.object({ databasePath: z.string().min(1).nullable() });

/** Source, offline run and preference settings; comparison durations resolve once at configuration. */
export const replaySettingsSchema = z.object({
  databasePath: z.string().trim().min(1),
  receiverPlayerID: z.number().int().min(0).max(21),
  fromTurn: z.number().int().min(0),
  toTurn: z.number().int().min(0),
  publicationInterval: z.number().int().positive(),
  durationUnit: z.enum(['recordedTurns', 'standardTurns']).default('recordedTurns'),
  comparisonTurns: z.number().int().min(0).default(0),
  speedMultiplierOverride: z.number().finite().positive().optional(),
  publicationEnabled: z.boolean().optional(),
  outputPath: z.string().trim().min(1).optional(),
  runId: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(['new', 'resume', 'branch']).optional(),
  branchFromRunId: z.string().min(1).max(200).optional(),
  editorialConfigDirectory: z.string().trim().min(1).optional(),
  frequencyStandardTurns: z.number().int().positive().optional(),
  llmEnabled: z.boolean().optional(),
}).refine(settings => settings.fromTurn <= settings.toTurn, {
  message: 'The turn range must be ordered.', path: ['toTurn'],
}).refine(settings => settings.mode !== 'resume' || !!settings.runId, { message: 'Resuming requires a runId.', path: ['runId'] })
  .refine(settings => settings.mode !== 'branch' || !!settings.branchFromRunId, { message: 'Branching requires branchFromRunId.', path: ['branchFromRunId'] });

/** Explain which pace supplied the resolved multiplier, including unknown recorded names. */
export const replaySpeedSchema = z.object({
  multiplier: z.number().finite().positive(),
  source: z.enum(['recorded', 'override', 'assumedStandard']),
  recordedName: z.string().nullable(),
  label: z.string(),
});

/** Current cutoff and the exclusive lower event bound for its evidence window. */
export const replayCursorSchema = z.object({
  cutoffTurn: z.number().int().min(0).nullable(),
  previousCheckTurn: z.number().int().min(-1),
  finished: z.boolean(),
});

/** Active session state returned after configuration and alongside each evidence result. */
export const replayStateSchema = z.object({
  settings: replaySettingsSchema,
  speed: replaySpeedSchema,
  publicationIntervalTurns: z.number().int().positive(),
  comparisonTurns: z.number().int().min(0),
  cursor: replayCursorSchema,
  runId: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  preferences: publicationPreferencesSchema.optional(),
});

/** Accepted editorial outcome saved with an advance, including quiet skipped periods. */
export const replayCheckSchema = z.object({
  status: z.enum(['published', 'skipped']),
  issue: issueDocumentSchema.optional(),
  decision: editorialDecisionRecordSchema,
  reason: z.string().optional(),
});

/** Saved receiver preferences change the schedule after the last completed cutoff. */
export const replayPreferencesRequestSchema = newspaperArchiveScopeSchema.extend({
  frequencyStandardTurns: z.number().int().positive(), llmEnabled: z.boolean(),
});

/** Evidence is exactly the MCP contract, paired with the replay state that selected it. */
export const replayEvidenceResponseSchema = z.object({
  session: replayStateSchema,
  evidence: newspaperEvidenceSchema,
  check: replayCheckSchema.optional(),
});

/** A completed batch step without the evidence or the full editorial decision. */
export const replayAdvanceSummaryResponseSchema = z.object({
  session: replayStateSchema,
  check: replayCheckSchema.pick({ status: true, reason: true }).extend({
    issueId: issueDocumentSchema.shape.issueId.optional(),
  }).optional(),
});

export type ReplaySettings = z.infer<typeof replaySettingsSchema>;
export type ReplaySpeed = z.infer<typeof replaySpeedSchema>;
export type ReplayState = z.infer<typeof replayStateSchema>;
export type ReplayEvidenceResponse = z.infer<typeof replayEvidenceResponseSchema>;
export type ReplayAdvanceSummaryResponse = z.infer<typeof replayAdvanceSummaryResponseSchema>;
