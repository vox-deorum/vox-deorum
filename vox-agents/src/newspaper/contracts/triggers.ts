/** Serialized trigger outcomes and repeat memory shared by replay and the editor. */
import { z } from 'zod';
import { newspaperSourceReferenceSchema } from '../../../../mcp-server/dist/newspaper/evidence.js';

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const subjectSchema = z.string().min(1);
const groupMatchSchema = z.strictObject({
  subject: subjectSchema,
  values: z.record(z.string(), scalarSchema),
});
const ratingFields = {
  tier: z.string().optional(),
  tierBase: z.number().finite().optional(),
  adjustments: z.array(z.strictObject({
    source: z.string(),
    points: z.number().finite(),
    error: z.string().optional(),
    hidden: z.string().optional(),
  })).optional(),
  importance: z.number().min(0).max(100).optional(),
  urgent: z.boolean().optional(),
};
const sourcesSchema = z.array(newspaperSourceReferenceSchema);
const expressionAuditSchema = z.strictObject({
  field: z.string(),
  source: z.string(),
  value: scalarSchema.optional(),
  error: z.string().optional(),
  hidden: z.string().optional(),
  sources: sourcesSchema.optional(),
});
const repeatEntrySchema = z.strictObject({ lastTurn: z.number().int().nonnegative(), armed: z.boolean() });
export const triggerRepeatStateSchema = z.record(z.string(), repeatEntrySchema);

export const triggerRuleAuditSchema = z.strictObject({
  rule: z.string(),
  windowFromTurn: z.number().int().min(-1),
  subjectCount: z.number().int().nonnegative(),
  subjects: z.array(z.strictObject({
    subject: subjectSchema,
    outcome: z.enum(['false', 'hidden', 'error', 'repeat', 'chance', 'matched', 'fired']),
    failedWhen: z.number().int().nonnegative().optional(),
    repeat: repeatEntrySchema.optional(),
    ...ratingFields,
    expressions: z.array(expressionAuditSchema),
    sources: sourcesSchema,
  })),
  groups: z.array(z.strictObject({
    subject: subjectSchema,
    key: scalarSchema,
    ...ratingFields,
    matches: z.array(groupMatchSchema),
    outcome: z.enum(['too-small', 'hidden', 'error', 'chance', 'fired']),
    expressions: z.array(expressionAuditSchema),
    sources: sourcesSchema,
  })),
});

export const ruleDevelopmentSchema = z.strictObject({
  id: z.string(),
  definitionId: z.string(),
  subject: subjectSchema,
  seriesKeys: z.array(z.string()),
  conflictKeys: z.array(z.string()).optional(),
  period: z.strictObject({ from: z.number().int().min(-1), to: z.number().int().nonnegative() }),
  tier: z.string().min(1),
  importance: z.number().min(0).max(100),
  urgent: z.boolean(),
  tags: z.array(z.string()),
  values: z.record(z.string(), z.union([scalarSchema, z.array(groupMatchSchema)])),
  sources: sourcesSchema,
  fingerprint: z.string(),
});

export type RuleScalar = z.infer<typeof scalarSchema>;
export type RuleGroupMatch = z.infer<typeof groupMatchSchema>;
export type RuleDevelopment = z.infer<typeof ruleDevelopmentSchema>;
export type TriggerRepeatState = z.infer<typeof triggerRepeatStateSchema>;
export type TriggerRuleAudit = z.infer<typeof triggerRuleAuditSchema>;
