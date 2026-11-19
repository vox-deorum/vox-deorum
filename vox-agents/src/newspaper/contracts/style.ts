/** Style metadata shared by authored variants and the publication audit. */
import { z } from 'zod';

export const variantStyleSchema = z.strictObject({
  voice: z.string().min(1),
  stance: z.string().min(1),
  genre: z.string().min(1),
});
export type VariantStyle = z.infer<typeof variantStyleSchema>;
export const variantStyleAxes = ['voice', 'stance', 'genre'] as const;
