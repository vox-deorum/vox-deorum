/** Validate publications and profiles against the shared renderer's capabilities. */
import { z } from "zod";
import {
  issueDocumentSchema,
  issueItemSchema,
  issuePublicationSchema,
  type IssueDocument,
  type NewspaperDesignId,
} from "../contracts/issue.js";
import { renderProfileSchema, type RenderProfile } from "../contracts/render.js";
import { getNewspaperAsset, isNewspaperAssetId } from "./assets.js";
import { computeRegionWidth, newspaperDesignDefaults } from "./layout.js";

/** Require a registered image asset for an illustrated item. */
const renderableIssueItemSchema = issueItemSchema.superRefine((item, ctx) => {
  if (!item.image) return;
  const { assetId } = item.image;
  if (!isNewspaperAssetId(assetId)) {
    ctx.addIssue({
      code: "custom",
      path: ["image", "assetId"],
      message: `Unknown asset "${assetId}".`,
    });
    return;
  }
  const asset = getNewspaperAsset(assetId);
  if (asset?.kind !== "image") {
    ctx.addIssue({
      code: "custom",
      path: ["image", "assetId"],
      message: `Asset "${assetId}" is not an image.`,
    });
  }
});

/** Require publication ornaments to name registered ornament assets. */
const renderableIssuePublicationSchema = issuePublicationSchema.superRefine((publication, ctx) => {
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
  publication: renderableIssuePublicationSchema,
  items: z.array(renderableIssueItemSchema).min(1),
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
