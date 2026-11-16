/** Validate publications and profiles against the shared renderer's capabilities. */
import { z } from "zod";
import {
  issueDocumentSchema,
  issueItemSchema,
  issuePublicationSchema,
  type IssueDocument,
} from "../contracts/issue.js";
import type { RendererFamily } from "../contracts/design.js";
import { renderProfileSchema, type RenderProfile } from "../contracts/render.js";
import { getNewspaperAsset, isNewspaperAssetId } from "./assets.js";
import { computeRenderLayout } from "./layout.js";

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
  const presentation = publication.presentation;
  for (const [name, assetId] of Object.entries(presentation.tokens ?? {})) {
    if (!name.endsWith("FontAssetId") || !assetId) continue;
    if (getNewspaperAsset(assetId)?.kind !== "font") {
      ctx.addIssue({ code: "custom", path: ["presentation", "tokens", name], message: `Asset "${assetId}" is not a registered font.` });
    }
  }
  const storedOrnament = presentation.assets?.ornamentAssetId;
  if (storedOrnament && getNewspaperAsset(storedOrnament)?.kind !== "ornament") {
    ctx.addIssue({ code: "custom", path: ["presentation", "assets", "ornamentAssetId"], message: `Asset "${storedOrnament}" is not a registered ornament.` });
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

/** Reject a profile whose derived content, capture viewport, or aligned texture width cannot fit. */
export function validateRenderProfileForDesign(
  profile: RenderProfile,
  designId: RendererFamily,
  requireCaptureViewport = true,
): void {
  const { regionWidth } = computeRenderLayout(designId, profile);
  const pixelWidth = Math.ceil(regionWidth * profile.rasterScale / 4) * 4;
  if (pixelWidth > profile.maxTextureWidth) {
    throw new Error(
      `Publication width ${pixelWidth}px exceeds the ${profile.maxTextureWidth}px texture limit.`,
    );
  }
  if (requireCaptureViewport && profile.viewportWidth < Math.ceil(pixelWidth / profile.rasterScale)) {
    throw new Error("Capture viewport width must include the paper and its texture alignment padding.");
  }
}
