/** Page and layout settings shared by the editor and browser preview. */
import { z } from 'zod';

/** Validate a nonempty expression in an authored catalogue. */
export const expressionSchema = z.string().refine((source) => source.trim().length > 0, 'Expected an expression.');
const weightSchema = z.strictObject({
  base: z.number().finite().default(1),
  adjustments: z.array(z.strictObject({ when: expressionSchema, add: z.number().finite() })).default([]),
});
/** An authored setting with an optional condition and a default weight of 1. */
export const eligibleSchema = z.strictObject({ when: expressionSchema.optional(), weight: weightSchema.prefault({}) });

/** A page layout; breaking layouts are reserved for the front page. */
export const editorialLayoutSchema = eligibleSchema.extend({
  id: z.string().min(1),
  variant: z.enum(['ordinary', 'breaking', 'analysis']),
});
export type EditorialLayout = z.infer<typeof editorialLayoutSchema>;

/** Defines the order, tags, and eligibility for a page. */
export const editorialPageSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  tags: z.array(z.string()),
  order: z.number(),
  front: z.boolean().default(false),
  when: expressionSchema.optional(),
});
