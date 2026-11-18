/** Compact pair continuity and inspector-only causal records for newspaper diplomacy. */
import { z } from 'zod';
import { newspaperSourceReferenceSchema } from '../../../../mcp-server/dist/newspaper/evidence.js';

export const warSampleSchema = z.object({ turn: z.number(), score: z.number().min(-100).max(100), source: newspaperSourceReferenceSchema });
export const diplomacyPairObservationSchema = z.object({
  turn: z.number(), state: z.enum(['war', 'peace', 'unknown']), since: z.number().nullable(),
  peaceAnchored: z.boolean(), warScore: z.number().min(-100).max(100).optional(),
  lastWarScore: warSampleSchema.optional(), friends: z.boolean().optional(), pact: z.boolean().optional(),
  sources: z.array(newspaperSourceReferenceSchema),
  sinceSources: z.array(newspaperSourceReferenceSchema).optional(),
  scoreSource: newspaperSourceReferenceSchema.optional(),
  observers: z.array(z.number()).optional(),
});
export type DiplomacyPairObservation = z.infer<typeof diplomacyPairObservationSchema>;
export const diplomacyPairSchema = z.object({
  players: z.tuple([z.number(), z.number()]), perspective: z.number(), state: z.enum(['war', 'peace', 'unknown']),
  since: z.number().nullable(), lastObserved: z.number().nullable(),
  peaceAnchored: z.boolean(),
  observations: z.array(diplomacyPairObservationSchema),
  foughtBefore: z.boolean(),
  lastWarScore: warSampleSchema.optional(),
  latestWarScore: warSampleSchema.optional(),
  lastWarSources: z.array(newspaperSourceReferenceSchema).optional(),
  lastKnownState: z.enum(['war', 'peace']).optional(),
  lastKnownSources: z.array(newspaperSourceReferenceSchema).optional(),
  sinceSources: z.array(newspaperSourceReferenceSchema).optional(),
});
export type DiplomacyPair = z.infer<typeof diplomacyPairSchema>;
export const diplomacyMemorySchema = z.object({ pairs: z.record(z.string(), diplomacyPairSchema), throughTurn: z.number().optional() });
export type DiplomacyMemory = z.infer<typeof diplomacyMemorySchema>;
export const diplomacyInferenceSchema = z.object({
  incidentId: z.string(), kind: z.enum(['war', 'peace', 'continuity']),
  stage: z.string().optional(), concessionTypes: z.string().optional(),
  rootInitiator: z.number().optional(), participants: z.array(z.number()),
  participationCause: z.string(), confidence: z.enum(['likely', 'corroborated', 'ambiguous']),
  alternatives: z.array(z.string()), sources: z.array(newspaperSourceReferenceSchema),
});
export type DiplomacyInference = z.infer<typeof diplomacyInferenceSchema>;

export type DiplomacyReason = 'root' | 'pact' | 'vassal' | 'master' | 'cityStateAlly' | 'inherited';
export interface DiplomacyIncidentFact {
  id: string;
  kind: 'war' | 'peace';
  turn: number;
  root: [number, number];
  rootRolesUnknown?: true;
  participants: { id: number; side: 'initiator' | 'target'; reason: DiplomacyReason }[];
  cityStates: number[];
  role?: 'initiator' | 'target' | 'joined' | 'none';
  reason?: DiplomacyReason;
  resumed: boolean;
  observed: boolean;
  partial: boolean;
  capitulation: boolean;
  concessions: string[];
  sources: z.infer<typeof newspaperSourceReferenceSchema>[];
  pair?: DiplomacyPairObservation;
}
