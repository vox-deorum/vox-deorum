/** Catalogue definitions and defaults for variant style preferences. */
import { z } from 'zod';
import { variantStyleKinds, type VariantStyle } from '../../contracts/style.js';

export const defaultVariantStyle = {
  voice: 'general', stance: 'neutral', genre: 'report',
} satisfies VariantStyle;

const styleEntrySchema = z.strictObject({
  id: z.string().min(1),
  guidance: z.string().optional(),
});
const styleTagListSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);

export const styleMatchSchema = z.strictObject({
  voice: styleTagListSchema.optional(),
  stance: styleTagListSchema.optional(),
  genre: styleTagListSchema.optional(),
}).refine(
  (match) => variantStyleKinds.some((kind) => match[kind] !== undefined),
  'Match at least one style tag.',
);
export type StyleMatch = z.infer<typeof styleMatchSchema>;

/** Normalize an authored single tag or tag list to a list. */
export function styleMatchTags(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

export const styleCatalogueSchema = z.strictObject({
  voice: z.array(styleEntrySchema),
  stance: z.array(styleEntrySchema),
  genre: z.array(styleEntrySchema),
  rules: z.array(z.strictObject({
    id: z.string().min(1),
    match: styleMatchSchema,
    when: z.string().regex(/\S/, 'Expected an expression.'),
    multiplier: z.number().finite().positive(),
  })),
});
export type StyleCatalogue = z.infer<typeof styleCatalogueSchema>;

/** Resolve absent legacy tags without adding defaults to the saved or hashed catalogue. */
export function resolveVariantStyle(tags: Partial<VariantStyle>): VariantStyle {
  return {
    voice: tags.voice ?? defaultVariantStyle.voice,
    stance: tags.stance ?? defaultVariantStyle.stance,
    genre: tags.genre ?? defaultVariantStyle.genre,
  };
}
