/** Validate publications and profiles against the shared renderer's capabilities. */
import { z } from "zod";
import {
  issueDocumentSchema,
  newspaperItemSchema,
  publicationIdentitySchema,
  type IssueDocument,
  type NewspaperDesignId,
} from "../contracts/issue.js";
import type { RenderProfile } from "./types.js";
import { getNewspaperAsset, isNewspaperAssetId } from "./assets.js";
import { computeRegionWidth, newspaperDesignDefaults } from "./layout.js";

/** Require a registered image and alternative text for an illustrated item. */
const renderableNewspaperItemSchema = newspaperItemSchema.superRefine((item, ctx) => {
  if (!item.assetId) return;
  if (!isNewspaperAssetId(item.assetId)) {
    ctx.addIssue({
      code: "custom",
      path: ["assetId"],
      message: `Unknown asset "${item.assetId}".`,
    });
    return;
  }
  const asset = getNewspaperAsset(item.assetId);
  if (asset?.kind !== "image") {
    ctx.addIssue({
      code: "custom",
      path: ["assetId"],
      message: `Asset "${item.assetId}" is not an image.`,
    });
  }
  if (!item.assetAlt) {
    ctx.addIssue({
      code: "custom",
      path: ["assetAlt"],
      message: "An item image needs alternative text.",
    });
  }
});

/** Require publication ornaments to name registered ornament assets. */
const renderablePublicationIdentitySchema = publicationIdentitySchema.superRefine((publication, ctx) => {
  const ornamentAssetId = publication.ornamentAssetId;
  if (!ornamentAssetId) return;
  if (!isNewspaperAssetId(ornamentAssetId)) {
    ctx.addIssue({
      code: "custom",
      path: ["ornamentAssetId"],
      message: `Unknown ornament asset "${ornamentAssetId}".`,
    });
    return;
  }
  if (getNewspaperAsset(ornamentAssetId)?.kind !== "ornament") {
    ctx.addIssue({
      code: "custom",
      path: ["ornamentAssetId"],
      message: `Asset "${ornamentAssetId}" is not an ornament.`,
    });
  }
});

/** Apply renderer asset rules while retaining structural issue reference checks. */
const renderableIssueDocumentSchema = issueDocumentSchema.safeExtend({
  publication: renderablePublicationIdentitySchema,
  items: z.array(renderableNewspaperItemSchema).min(1),
});

/** Schema for a fixed export profile. */
export const renderProfileSchema = z.object({
  viewportWidth: z.number().finite().positive(),
  viewportHeight: z.number().finite().positive(),
  contentWidth: z.number().finite().positive(),
  textScale: z.number().finite().positive().max(3),
  rasterScale: z.number().finite().positive().max(4),
  maxTextureWidth: z.number().int().positive(),
  maxTextureHeight: z.number().int().positive(),
  scrollbarGutter: z.number().finite().nonnegative().max(64),
});

/** Parse an issue document and enforce the renderer's asset rules. */
export function parseIssueDocument(input: unknown): IssueDocument {
  return renderableIssueDocumentSchema.parse(input);
}

/** Parse a render profile or throw a validation error. */
export function parseRenderProfile(input: unknown): RenderProfile {
  return renderProfileSchema.parse(input);
}

/** Reject a profile that cannot fit the fixed publication width in a texture. */
export function validateRenderProfileForDesign(
  profile: RenderProfile,
  designId: NewspaperDesignId,
): void {
  const regionWidth = computeRegionWidth(designId, profile.contentWidth, profile.scrollbarGutter);
  const pixelWidth = Math.ceil(regionWidth * profile.rasterScale);
  if (pixelWidth > profile.maxTextureWidth) {
    throw new Error(
      `Publication width ${pixelWidth}px exceeds the ${profile.maxTextureWidth}px texture limit.`,
    );
  }
  const defaults = newspaperDesignDefaults[designId];
  if (profile.contentWidth < defaults.paperPadding) {
    throw new Error("Content width leaves no room for the publication margins.");
  }
}
