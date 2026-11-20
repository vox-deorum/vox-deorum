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
  table: z.enum(['PlayerSummaries', 'CityInformations', 'GameEvents', 'TacticalZones', 'VictoryProgress'])
    .describe('Source table'),
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

/** The most recent named change for a technology on the receiving team. */
export const newspaperTechnologySchema = z.object({
  source: newspaperSourceReferenceSchema.extend({ table: z.literal('GameEvents') }),
  name: z.string().describe('Technology name in the recording'),
  gained: z.boolean().describe('Whether the last recorded change was a gain')
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
    warWeariness: z.number().int().min(0).max(100).optional()
      .describe('Weariness reported by the observing major only under recorded full access during an active war'),
    proximity: z.enum(['Neighbors', 'Close', 'Far', 'Distant']).optional()
      .describe('Raw distance label from the observation, excluding the Unknown placeholder'),
    influence: z.number().int().optional().describe('Signed city-state influence held by the resolved major'),
    protected: z.boolean().optional().describe('Whether the resolved major protects the city-state, when the summary syntax is valid'),
    defensivePact: z.literal(true).optional().describe('An observed defensive pact with the target'),
    peaceTreaty: z.literal(true).optional().describe('An observed active peace treaty with the target'),
    friendship: z.literal(true).optional().describe('An observed declaration of friendship or city-state friendship'),
    ally: z.literal(true).optional().describe('An observed city-state alliance with the target'),
    vassal: z.enum(['voluntary', 'capitulated']).optional().describe('The target is the observing player\'s vassal'),
    master: z.enum(['voluntary', 'capitulated']).optional().describe('The target is the observing player\'s master'),
    denouncedThem: z.boolean().optional().describe('The observing player denounced the target; false is explicit for a full major entry'),
    denouncedByThem: z.literal(true).optional().describe('The target denounced the observing player'),
    openBordersTo: z.boolean().optional().describe('The observing player granted the target open borders; false is explicit for a full major entry')
  })).describe('Directed relationship facts permitted by dated summary access'),
  majorAllyPlayerID: z.number().int().nullable().optional().describe('Visible resolved city-state ally; null means explicitly no ally')
});

/** One private front observation recorded for the receiving player. */
export const newspaperTacticalZoneSchema = z.object({
  source: newspaperSourceReferenceSchema.extend({ table: z.literal('TacticalZones') })
    .describe('Latest recorded zone row and its observation date'),
  zoneID: z.number().int().describe('Recorded tactical zone ID; negative IDs are valid and zero is excluded'),
  city: z.string().optional().describe('Recorded city label when the zone names a city'),
  domain: z.string().describe('Recorded zone domain label'),
  posture: z.string().describe('Recorded tactical posture assessment'),
  units: z.record(z.string(), z.record(z.string(), z.number()))
    .describe('Visible unit counts by civilization label and recorded unit type')
});

/** One recorded World Congress proposal. */
export const newspaperCongressProposalSchema = z.object({
  name: z.string().describe('Resolution name without the recorded Enact or Repeal prefix'),
  isEnact: z.boolean().describe('Whether the proposal would enact rather than repeal the resolution'),
  proposer: z.string().optional().describe('Recorded proposer label when one is named'),
  description: z.string().optional().describe('Recorded resolution help text')
});

/** One resolution already active in the league. */
export const newspaperCongressResolutionSchema = z.object({
  name: z.string().describe('Recorded resolution name'),
  description: z.string().optional().describe('Recorded resolution help text'),
  enactedTurn: z.number().int().optional()
    .describe('Turn the resolution was enacted, which may predate this observation')
});

/** One public Congress snapshot derived from recorded victory progress. */
export const newspaperCongressObservationSchema = z.object({
  source: newspaperSourceReferenceSchema.extend({ table: z.literal('VictoryProgress') })
    .describe('Recorded victory-progress row and observation date'),
  available: z.boolean()
    .describe('Whether a league was available; false is a known locked snapshot with an empty agenda'),
  league: z.string().optional().describe('Recorded World Congress or United Nations label'),
  votingNow: z.boolean().describe('Whether the snapshot observed an active voting session'),
  expectedSessionTurn: z.number().int().optional()
    .describe('Observation turn plus the recorded countdown'),
  diplomaticVictoryVotesNeeded: z.number().int().optional()
    .describe('Recorded delegate threshold for diplomatic victory'),
  proposals: z.array(newspaperCongressProposalSchema).optional().describe('Recorded proposals, preserving an empty agenda'),
  activeResolutions: z.array(newspaperCongressResolutionSchema).optional()
    .describe('Recorded active resolutions, preserving an empty agenda')
});

/** Baseline and window observations for the public Congress record. */
export const newspaperCongressEvidenceSchema = z.object({
  baseline: newspaperCongressObservationSchema.optional()
    .describe('Latest usable snapshot at or before the previous check'),
  observations: z.array(newspaperCongressObservationSchema)
    .describe('Final snapshot per turn after the previous check through the cutoff, omitted when unreadable')
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
  receiverTechnologies: z.array(newspaperTechnologySchema).optional()
    .describe('Last recorded change per named technology on the receiving team through the cutoff'),
  tacticalZones: z.array(newspaperTacticalZoneSchema).optional()
    .describe('Latest permitted observation per zone during the cutoff turn, ordered by zone ID; absent when the table is unavailable'),
  history: newspaperHistorySchema.optional().describe('Trigger history when a start turn is requested'),
  diplomacy: z.object({
    fromTurn: z.number().int().describe('Inclusive first observation turn'),
    baseline: z.array(newspaperDiplomacySnapshotSchema).describe('Latest observations before the evidence window, with original source dates'),
    history: z.array(newspaperDiplomacySnapshotSchema).describe('Dated final observations per subject and turn throughout the evidence window'),
    gaps: z.array(newspaperDiplomacyGapSchema).describe('Unknown or unresolved relationship observations')
  }).optional().describe('Derived public diplomacy evidence, separate from raw snapshots'),
  congress: newspaperCongressEvidenceSchema.optional()
    .describe('Derived public Congress evidence, read without visibility flags and separate from raw snapshots')
});

export type NewspaperEvidenceRequest = z.infer<typeof newspaperEvidenceRequestSchema>;
export type NewspaperSourceReference = z.infer<typeof newspaperSourceReferenceSchema>;
export type NewspaperSnapshot = z.infer<typeof newspaperSnapshotSchema>;
export type NewspaperEvent = z.infer<typeof newspaperEventSchema>;
export type NewspaperTechnology = z.infer<typeof newspaperTechnologySchema>;
export type NewspaperTacticalZone = z.infer<typeof newspaperTacticalZoneSchema>;
export type NewspaperHistory = z.infer<typeof newspaperHistorySchema>;
export type NewspaperEvidence = z.infer<typeof newspaperEvidenceSchema>;
export type NewspaperDiplomacySnapshot = z.infer<typeof newspaperDiplomacySnapshotSchema>;
export type NewspaperDiplomacyGap = z.infer<typeof newspaperDiplomacyGapSchema>;
export type NewspaperCongressProposal = z.infer<typeof newspaperCongressProposalSchema>;
export type NewspaperCongressResolution = z.infer<typeof newspaperCongressResolutionSchema>;
export type NewspaperCongressObservation = z.infer<typeof newspaperCongressObservationSchema>;
export type NewspaperCongressEvidence = z.infer<typeof newspaperCongressEvidenceSchema>;

/** Date a deferred report by its eligible turn while preserving its original citation date. */
export function eventReportTurn(event: NewspaperEvent): number {
  return event.reportTurn ?? event.source.turn;
}
