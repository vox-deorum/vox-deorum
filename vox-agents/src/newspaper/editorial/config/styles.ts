/** Catalogue definitions and defaults for variant style preferences. */
import { z } from 'zod';
import { variantStyleAxes, variantStyleSchema, type VariantStyle } from '../../contracts/style.js';

export const defaultVariantStyle = {
  voice: 'general', stance: 'neutral', genre: 'report',
} satisfies VariantStyle;

const styleEntrySchema = z.strictObject({
  id: z.string().min(1),
  guidance: z.string().optional(),
});

export const styleCatalogueSchema = z.strictObject({
  voice: z.array(styleEntrySchema),
  stance: z.array(styleEntrySchema),
  genre: z.array(styleEntrySchema),
  rules: z.array(z.strictObject({
    id: z.string().min(1),
    match: variantStyleSchema.partial().refine(
      (match) => variantStyleAxes.some((axis) => match[axis] !== undefined),
      'Match at least one style tag.',
    ),
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
