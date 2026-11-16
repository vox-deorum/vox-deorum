import { z } from 'zod';
import { newspaperEvidenceSchema } from '../../../../mcp-server/dist/newspaper/evidence.js';

/** In-memory replay input; durations use the selected unit and are converted once at configuration. */
export const replaySettingsSchema = z.object({
  databasePath: z.string().trim().min(1),
  receiverPlayerID: z.number().int().min(0).max(21),
  fromTurn: z.number().int().min(0),
  toTurn: z.number().int().min(0),
  publicationInterval: z.number().int().positive(),
  durationUnit: z.enum(['recordedTurns', 'standardTurns']).default('recordedTurns'),
  comparisonTurns: z.number().int().min(0).default(0),
  speedMultiplierOverride: z.number().finite().positive().optional(),
}).refine(settings => settings.fromTurn <= settings.toTurn, {
  message: 'The turn range must be ordered.', path: ['toTurn'],
});

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
});

/** Evidence is exactly the MCP contract, paired with the replay state that selected it. */
export const replayEvidenceResponseSchema = z.object({
  session: replayStateSchema,
  evidence: newspaperEvidenceSchema,
});

export type ReplaySettings = z.infer<typeof replaySettingsSchema>;
export type ReplaySpeed = z.infer<typeof replaySpeedSchema>;
export type ReplayState = z.infer<typeof replayStateSchema>;
export type ReplayEvidenceResponse = z.infer<typeof replayEvidenceResponseSchema>;
