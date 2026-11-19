import { z } from 'zod';

/** Recorded-turn request shared by MCP, offline replay, and the browser. */
export const newspaperEvidenceRequestSchema = z.object({
  receiverPlayerID: z.number().int().min(0).max(21).describe('Receiving major civilization player ID'),
  previousCheckTurn: z.number().int().min(-1).describe('Exclusive lower event turn bound'),
  cutoffTurn: z.number().int().min(0).describe('Inclusive cutoff in recorded game turns'),
  historyFromTurn: z.number().int().min(-1).optional()
    .describe('Start turn for trigger history, or -1 to include turn zero; history also covers the previous check'),
  comparisonRange: z.object({
    fromTurn: z.number().int().min(0).describe('Inclusive first comparison turn'),
    toTurn: z.number().int().min(0).describe('Inclusive last comparison turn')
  }).optional().describe('Optional bounded snapshot history in recorded game turns')
}).refine(request => request.previousCheckTurn <= request.cutoffTurn, {
  message: 'Previous check must be at or before cutoff', path: ['previousCheckTurn']
}).refine(request => !request.comparisonRange || (
  request.comparisonRange.fromTurn <= request.comparisonRange.toTurn && request.comparisonRange.toTurn <= request.cutoffTurn
), { message: 'Comparison range must be ordered and at or before cutoff', path: ['comparisonRange'] })
  .refine(request => request.historyFromTurn === undefined || request.historyFromTurn <= request.cutoffTurn,
    { message: 'History must start at or before cutoff', path: ['historyFromTurn'] });

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
  relatedSources: z.array(newspaperSourceReferenceSchema).optional().describe('Permitted supporting rows used for joined values'),
  subjectID: z.number().int().describe('Original subject Key, including the existing city ID'),
  values: z.record(z.string(), z.unknown()).describe('Selected raw fields without display conversions')
});

/** Permitted event payload with its original identity and date. */
export const newspaperEventSchema = z.object({
  source: newspaperSourceReferenceSchema,
  relatedSources: z.array(newspaperSourceReferenceSchema).optional().describe('Permitted supporting rows used for joined values'),
  type: z.string().describe('Recorded event type'),
  reportTurn: z.number().int().min(0).optional()
    .describe('Effective report turn when a defender report follows the original operation turn'),
  values: z.record(z.string(), z.unknown()).describe('Selected raw event payload')
});

/** Public relationship observations derived from a visible dated summary. */
export const newspaperDiplomacySnapshotSchema = z.object({
  source: newspaperSourceReferenceSchema.describe('Original national summary row and observation date'),
  subjectID: z.number().int().describe('Observing player'),
  teamID: z.number().int().describe('Observing player team'),
  isMajor: z.boolean().describe('Whether the observing player is a major civilization'),
  relationships: z.array(z.object({
    targetPlayerID: z.number().int().describe('Uniquely resolved visible player'),
    targetTeamID: z.number().int().describe('Resolved player team'),
    state: z.enum(['war', 'peace', 'unknown']).describe('Explicit relationship observation; missing entries never imply peace'),
    warScore: z.number().optional().describe('Directional score reported by the observing major'),
    defensivePact: z.literal(true).optional().describe('An observed defensive pact with the target'),
    peaceTreaty: z.literal(true).optional().describe('An observed active peace treaty with the target'),
    friendship: z.literal(true).optional().describe('An observed declaration of friendship or city-state friendship'),
    ally: z.literal(true).optional().describe('An observed city-state alliance with the target'),
    vassal: z.enum(['voluntary', 'capitulated']).optional().describe('The target is the observing player\'s vassal'),
    master: z.enum(['voluntary', 'capitulated']).optional().describe('The target is the observing player\'s master')
  })).describe('Public relationship facts with private suffixes removed'),
  majorAllyPlayerID: z.number().int().nullable().optional().describe('Visible resolved city-state ally; null means explicitly no ally')
});

/** Incomplete diplomatic observations stay separate from city lifecycle limitations. */
export const newspaperDiplomacyGapSchema = z.object({
  source: newspaperSourceReferenceSchema.describe('Original national summary row containing the incomplete observation'),
  subjectID: z.number().int().describe('Player whose diplomatic observation could not be fully resolved'),
  kind: z.enum(['unresolvedIdentity', 'ambiguousIdentity', 'missingRelationships', 'unknownRelationship'])
    .describe('Reason the recorded identity or relationship could not be established')
});

const newspaperSnapshotSetSchema = z.object({
  players: z.array(newspaperSnapshotSchema),
  cities: z.array(newspaperSnapshotSchema)
});

/** Bounded trigger inputs kept separate from the reporting period and comparison reads. */
export const newspaperHistorySchema = z.object({
  fromTurn: z.number().int().min(-1).describe('Baseline turn and exclusive lower bound for dated history'),
  baseline: newspaperSnapshotSetSchema.describe('Final observation per subject at or before the baseline turn, omitted if hidden'),
  snapshots: newspaperSnapshotSetSchema.describe('Permitted final observations per subject and turn, oldest first'),
  gaps: z.array(z.object({
    table: z.enum(['PlayerSummaries', 'CityInformations']),
    subjectID: z.number().int(),
    turn: z.number().int().nonnegative()
  })).describe('First turn an established observation became unavailable, including a known city removal'),
  events: z.array(newspaperEventSchema).describe('Permitted events after the baseline through cutoff, oldest first')
});

/** Small evidence envelope reused by both database access paths. */
export const newspaperEvidenceSchema = z.object({
  request: newspaperEvidenceRequestSchema,
  limitations: z.array(z.enum(['cityLifecycleUnresolved', 'cityLifecycleOrderUnknown'])).optional()
    .describe('City lifecycle records with missing coordinates or ambiguous same-turn timestamp ordering; city snapshots may be stale'),
  players: z.array(newspaperSnapshotSchema).describe('Latest permitted national snapshots at cutoff'),
  cities: z.array(newspaperSnapshotSchema).describe('Latest permitted city snapshots at cutoff'),
  comparisons: newspaperSnapshotSetSchema.describe('Final insertion per subject and turn within the requested comparison range'),
  events: z.array(newspaperEventSchema).describe('Permitted events after previous check through cutoff'),
  history: newspaperHistorySchema.optional().describe('Trigger history when a start turn is requested'),
  diplomacy: z.object({
    fromTurn: z.number().int().describe('Inclusive first observation turn'),
    baseline: z.array(newspaperDiplomacySnapshotSchema).describe('Latest observations before the evidence window, with original source dates'),
    history: z.array(newspaperDiplomacySnapshotSchema).describe('Dated final observations per subject and turn throughout the evidence window'),
    gaps: z.array(newspaperDiplomacyGapSchema).describe('Unknown or unresolved relationship observations')
  }).optional().describe('Derived public diplomacy evidence, separate from raw snapshots')
});

export type NewspaperEvidenceRequest = z.infer<typeof newspaperEvidenceRequestSchema>;
export type NewspaperSourceReference = z.infer<typeof newspaperSourceReferenceSchema>;
export type NewspaperSnapshot = z.infer<typeof newspaperSnapshotSchema>;
export type NewspaperEvent = z.infer<typeof newspaperEventSchema>;
export type NewspaperHistory = z.infer<typeof newspaperHistorySchema>;
export type NewspaperEvidence = z.infer<typeof newspaperEvidenceSchema>;
export type NewspaperDiplomacySnapshot = z.infer<typeof newspaperDiplomacySnapshotSchema>;
export type NewspaperDiplomacyGap = z.infer<typeof newspaperDiplomacyGapSchema>;

/** Date a deferred report by its eligible turn while preserving its original citation date. */
export function eventReportTurn(event: NewspaperEvent): number {
  return event.reportTurn ?? event.source.turn;
}
