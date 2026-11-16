import { z } from 'zod';

/** Recorded-turn request shared by MCP, offline replay, and the browser. */
export const newspaperEvidenceRequestSchema = z.object({
  receiverPlayerID: z.number().int().min(0).max(21).describe('Receiving major civilization player ID'),
  previousCheckTurn: z.number().int().min(-1).describe('Exclusive lower event turn bound'),
  cutoffTurn: z.number().int().min(0).describe('Inclusive cutoff in recorded game turns'),
  comparisonRange: z.object({
    fromTurn: z.number().int().min(0).describe('Inclusive first comparison turn'),
    toTurn: z.number().int().min(0).describe('Inclusive last comparison turn')
  }).optional().describe('Optional bounded snapshot history in recorded game turns')
}).refine(request => request.previousCheckTurn <= request.cutoffTurn, {
  message: 'Previous check must be at or before cutoff', path: ['previousCheckTurn']
}).refine(request => !request.comparisonRange || (
  request.comparisonRange.fromTurn <= request.comparisonRange.toTurn && request.comparisonRange.toTurn <= request.cutoffTurn
), { message: 'Comparison range must be ordered and at or before cutoff', path: ['comparisonRange'] });

/** Direct reference to a recorded row, captured before field projection. */
export const newspaperSourceReferenceSchema = z.object({
  table: z.enum(['PlayerSummaries', 'CityInformations', 'GameEvents']).describe('Source table'),
  id: z.number().int().describe('Original insertion or event ID'),
  turn: z.number().int().describe('Original recorded game turn'),
  createdAt: z.number().describe('Original recorded Unix timestamp in seconds')
});

/** Permitted raw snapshot values; absent fields remain unknown. */
export const newspaperSnapshotSchema = z.object({
  source: newspaperSourceReferenceSchema,
  subjectID: z.number().int().describe('Original subject Key, including the existing city ID'),
  values: z.record(z.string(), z.unknown()).describe('Selected raw fields without display conversions')
});

/** Permitted event payload with its original identity and date. */
export const newspaperEventSchema = z.object({
  source: newspaperSourceReferenceSchema,
  type: z.string().describe('Recorded event type'),
  values: z.record(z.string(), z.unknown()).describe('Selected raw event payload')
});

/** Small evidence envelope reused by both database access paths. */
export const newspaperEvidenceSchema = z.object({
  request: newspaperEvidenceRequestSchema,
  limitations: z.array(z.enum(['cityLifecycleUnresolved', 'cityLifecycleOrderUnknown'])).optional()
    .describe('City lifecycle records with missing coordinates or ambiguous same-turn timestamp ordering; city snapshots may be stale'),
  players: z.array(newspaperSnapshotSchema).describe('Latest permitted national snapshots at cutoff'),
  cities: z.array(newspaperSnapshotSchema).describe('Latest permitted city snapshots at cutoff'),
  comparisons: z.object({
    players: z.array(newspaperSnapshotSchema),
    cities: z.array(newspaperSnapshotSchema)
  }).describe('Final insertion per subject and turn within the requested comparison range'),
  events: z.array(newspaperEventSchema).describe('Permitted events after previous check through cutoff')
});

export type NewspaperEvidenceRequest = z.infer<typeof newspaperEvidenceRequestSchema>;
export type NewspaperSourceReference = z.infer<typeof newspaperSourceReferenceSchema>;
export type NewspaperSnapshot = z.infer<typeof newspaperSnapshotSchema>;
export type NewspaperEvent = z.infer<typeof newspaperEventSchema>;
export type NewspaperEvidence = z.infer<typeof newspaperEvidenceSchema>;
