/** Compact pair continuity and inspector-only causal records for newspaper diplomacy. */
import { z } from 'zod';
import { newspaperSourceReferenceSchema } from '../../../../mcp-server/dist/newspaper/evidence.js';

export const warSampleSchema = z.object({ turn: z.number(), score: z.number().min(-100).max(100), source: newspaperSourceReferenceSchema });
export const diplomacyPairSchema = z.object({
  players: z.tuple([z.number(), z.number()]), perspective: z.number(), state: z.enum(['war', 'peace', 'unknown']),
  since: z.number().nullable(), lastObserved: z.number().nullable(), samples: z.array(warSampleSchema),
  lastPublication: z.number().nullable(), advantageArmed: z.boolean(), commandingArmed: z.boolean(),
  lastKinds: z.record(z.string(), z.string()), enduringPublished: z.boolean(),
  peaceAnchored: z.boolean(),
  stagnationScore: z.number().min(-100).max(100).nullable(),
  stagnationEpisodeTurn: z.number().int().nullable(),
});
export type DiplomacyPair = z.infer<typeof diplomacyPairSchema>;
export const diplomacyMemorySchema = z.object({ pairs: z.record(z.string(), diplomacyPairSchema) });
export type DiplomacyMemory = z.infer<typeof diplomacyMemorySchema>;
export const diplomacyInferenceSchema = z.object({
  incidentId: z.string(), kind: z.enum(['war', 'peace', 'progress', 'continuity']),
  rootInitiator: z.number().optional(), participants: z.array(z.number()),
  participationCause: z.string(), confidence: z.enum(['likely', 'corroborated', 'ambiguous']),
  alternatives: z.array(z.string()), sources: z.array(newspaperSourceReferenceSchema),
});
export type DiplomacyInference = z.infer<typeof diplomacyInferenceSchema>;
