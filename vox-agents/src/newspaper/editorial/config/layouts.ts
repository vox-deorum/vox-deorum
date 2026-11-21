/** Page and layout settings shared by the editor and browser preview. */
import { z } from 'zod';

/** Validate a nonempty expression in an authored catalogue. */
export const expressionSchema = z.string().refine((source) => source.trim().length > 0, 'Expected an expression.');
const weightSchema = z.strictObject({
  base: z.number().finite(),
  adjustments: z.array(z.strictObject({ when: expressionSchema, add: z.number().finite() })).default([]),
});
/** An authored setting with an optional condition and a weight. */
export const eligibleSchema = z.strictObject({ when: expressionSchema.optional(), weight: weightSchema });

/** Smallest front page a design can print. */
export const minimumFrontSlots = 4;
const frontLayoutSchema = eligibleSchema.extend({
  id: z.string().min(1),
  frontSlots: z.number().int().min(minimumFrontSlots),
});

/** A front layout can also serve as an interior layout unless it is breaking. */
export const editorialLayoutSchema = z.discriminatedUnion('variant', [
  frontLayoutSchema.extend({
    variant: z.literal('breaking'),
    sectionSlots: z.never().optional(),
  }),
  frontLayoutSchema.extend({
    variant: z.enum(['ordinary', 'analysis']),
    sectionSlots: z.number().int().positive(),
  }),
]).refine(
  layout => layout.variant !== 'breaking' || !Object.hasOwn(layout, 'sectionSlots'),
  { path: ['sectionSlots'], message: 'Breaking layouts cannot define sectionSlots.' },
);
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
