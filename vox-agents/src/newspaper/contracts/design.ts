/** Stored presentation values remain independent of renderer and host services. */
import { z } from 'zod';

/** Fixed renderer families available to configurable publication designs. */
export const rendererFamilySchema = z.enum(['inscription', 'broadsheet', 'feed', 'folio']);
/** A visual family supported by the shared renderer. */
export type RendererFamily = z.infer<typeof rendererFamilySchema>;
/** Immutable visual settings stored with an issue. */
export const presentationSchema = z.object({
  schemaVersion: z.literal(1),
  rendererFamily: rendererFamilySchema,
  tokens: z.object({
    paperColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    inkColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    bodyFontAssetId: z.string().min(1).optional(),
    headingFontAssetId: z.string().min(1).optional(),
    mastheadFontAssetId: z.string().min(1).optional(),
  }).optional(),
  assets: z.object({ ornamentAssetId: z.string().min(1).optional() }).optional(),
});
/** Immutable visual settings stored with an issue. */
export type PublicationPresentation = z.infer<typeof presentationSchema>;
