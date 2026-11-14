/**
 * Runtime validation for saved render bundles.
 *
 * A bundle crosses from the browser export worker into the disk cache and then
 * the game viewer. These checks keep unsafe texture paths, incomplete strip
 * plans, and geometry that cannot belong to the declared profile out of the
 * cache.
 */
import { computeRegionWidth } from "../ui/layout.js";
import { newspaperVoteIconAssets } from "../ui/assets.js";
import { z } from "zod";

import {
  newspaperDesignIds,
  newspaperLayoutVariants,
  newspaperRenderBundleSchemaVersion,
  newspaperRendererVersion,
  type ActionGeometry,
  type Rect,
  type RenderBundle,
  type RenderHeaderBundle,
  type RenderPageBundle,
  type RenderRegion,
  type RenderStrip,
  type TabGeometry,
  type VoteSlotGeometry,
} from "./types.js";
import {
  readerActionSchema,
  renderProfileSchema,
  validateRenderProfileForDesign,
} from "./validation.js";

/** Largest difference allowed between scaled CSS height and exported texture pixels. */
const maxStripPadding = 3;

/** Tolerance for fractional CSS measurements that pass through JSON unchanged. */
const cssTolerance = 0.001;

/** A Zod issue path inside a bundle document. */
type BundlePath = (string | number)[];

/** Schema for a rectangle in CSS pixels relative to its region. */
const rectSchema: z.ZodType<Rect> = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

/** Schema for a header or page region reference. */
const renderRegionSchema: z.ZodType<RenderRegion> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("header") }),
  z.object({ kind: z.literal("page"), pageId: z.string().min(1) }),
]);

/** Schema for one saved image strip. */
const renderStripSchema: z.ZodType<RenderStrip> = z.object({
  index: z.number().int().nonnegative(),
  fileName: z.string().min(1),
  clip: rectSchema,
  visibleHeight: z.number().finite().positive(),
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
});

/** Schema for one interactive element in a saved bundle. */
const actionGeometrySchema: z.ZodType<ActionGeometry> = z.object({
  actionId: z.string().min(1),
  region: renderRegionSchema,
  action: readerActionSchema,
  rects: z.array(rectSchema),
});

/** Schema for one header tab in a saved bundle. */
const tabGeometrySchema: z.ZodType<TabGeometry> = z.object({
  pageId: z.string().min(1),
  label: z.string(),
  rect: rectSchema,
});

/** Schema for one dynamic vote slot in a saved bundle. */
const voteSlotGeometrySchema: z.ZodType<VoteSlotGeometry> = z.object({
  itemId: z.string().min(1),
  value: z.enum(["up", "down"]),
  region: renderRegionSchema,
  rect: rectSchema,
  neutralAssetId: z.string().min(1),
  selectedAssetId: z.string().min(1),
});

/** Schema for the masthead and tab portion of a bundle. */
const headerBundleSchema: z.ZodType<RenderHeaderBundle> = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  strips: z.array(renderStripSchema).min(1),
  actions: z.array(actionGeometrySchema),
  tabs: z.array(tabGeometrySchema),
});

/** Schema for one expanded page section in a bundle. */
const pageBundleSchema: z.ZodType<RenderPageBundle> = z.object({
  pageId: z.string().min(1),
  layout: z.enum(newspaperLayoutVariants),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  contentHeight: z.number().finite().positive(),
  contentWidth: z.number().finite().positive(),
  scrollbarGutter: z.number().finite().nonnegative(),
  strips: z.array(renderStripSchema).min(1),
  actions: z.array(actionGeometrySchema),
  voteSlots: z.array(voteSlotGeometrySchema),
});

/** Schema for the complete serialized render bundle. */
const renderBundleSchema: z.ZodType<RenderBundle> = z
  .object({
    schemaVersion: z.literal(newspaperRenderBundleSchemaVersion),
    rendererVersion: z.literal(newspaperRendererVersion),
    browserVersion: z.string().min(1),
    issueId: z.string().min(1),
    campaignId: z.string().min(1),
    timelineId: z.string().min(1),
    designId: z.enum(newspaperDesignIds),
    designVersion: z.string().min(1),
    profile: renderProfileSchema,
    header: headerBundleSchema,
    pages: z.array(pageBundleSchema).min(1),
  })
  .superRefine(refineRenderBundle);

/** Report one bundle consistency problem at a Zod path. */
function addIssue(ctx: z.RefinementCtx, path: BundlePath, message: string): void {
  ctx.addIssue({ code: "custom", path, message });
}

/** Compare two CSS measurements without rejecting harmless fractional noise. */
function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= cssTolerance;
}

/** Tell whether a filename is a plain DDS basename that cannot escape the bundle directory. */
function isSafeDdsName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+\.dds$/.test(name);
}

/** Tell whether two region references name the same header or page. */
function sameRegion(left: RenderRegion, right: RenderRegion): boolean {
  if (left.kind === "header" || right.kind === "header") return left.kind === right.kind;
  return left.pageId === right.pageId;
}

/** Tell whether a rectangle stays inside a region of the given CSS size. */
function rectFits(rect: Rect, width: number, height: number): boolean {
  return (
    rect.x + rect.width <= width + cssTolerance &&
    rect.y + rect.height <= height + cssTolerance
  );
}

/** Check one region's strips for order, contiguous coverage, pixel limits, and safe texture names. */
function validateStrips(
  strips: RenderStrip[],
  width: number,
  height: number,
  rasterScale: number,
  maxTextureWidth: number,
  maxTextureHeight: number,
  path: BundlePath,
  ctx: z.RefinementCtx,
): void {
  let nextY = 0;
  let physicalHeight = 0;
  const expectedWidth = Math.ceil(width * rasterScale);

  strips.forEach((strip, stripIndex) => {
    const stripPath: BundlePath = [...path, stripIndex];
    if (strip.index !== stripIndex) {
      addIssue(ctx, [...stripPath, "index"], "Strip indices must be contiguous and start at zero.");
    }
    if (
      strip.clip.x !== 0 ||
      !nearlyEqual(strip.clip.width, width) ||
      !nearlyEqual(strip.clip.y, nextY)
    ) {
      addIssue(ctx, [...stripPath, "clip"], "Strip clips must be contiguous full-width slices.");
    }
    if (!nearlyEqual(strip.clip.height, strip.visibleHeight)) {
      addIssue(ctx, [...stripPath, "clip", "height"], "A strip clip height must equal its visible height.");
    }
    if (!isSafeDdsName(strip.fileName)) {
      addIssue(ctx, [...stripPath, "fileName"], "A strip texture needs a safe DDS basename.");
    }
    if (strip.pixelWidth < expectedWidth || strip.pixelWidth - expectedWidth > maxStripPadding) {
      addIssue(ctx, [...stripPath, "pixelWidth"], "A strip width must match the scaled region width.");
    }
    const expectedHeight = Math.ceil(strip.visibleHeight * rasterScale);
    if (
      strip.pixelHeight < expectedHeight ||
      strip.pixelHeight - expectedHeight > maxStripPadding
    ) {
      addIssue(ctx, [...stripPath, "pixelHeight"], "A strip height must match its scaled visible height.");
    }
    if (strip.pixelWidth > maxTextureWidth || strip.pixelHeight > maxTextureHeight) {
      addIssue(ctx, [...stripPath], "A strip exceeds the profile texture limits.");
    }
    nextY += strip.visibleHeight;
    physicalHeight += strip.pixelHeight;
  });

  if (!nearlyEqual(nextY, height)) {
    addIssue(ctx, path, "Strip visible heights must cover the complete region height.");
  }
  const scaledHeight = Math.ceil(height * rasterScale);
  if (physicalHeight < scaledHeight || physicalHeight - scaledHeight > maxStripPadding) {
    addIssue(ctx, path, "Strip pixels must cover the region with at most three pixels of padding.");
  }
}

/** Check one action's region, rectangles, and references that the bundle can resolve. */
function validateAction(
  action: ActionGeometry,
  expectedRegion: RenderRegion,
  width: number,
  height: number,
  pageIds: ReadonlySet<string>,
  itemIds: ReadonlySet<string> | undefined,
  path: BundlePath,
  ctx: z.RefinementCtx,
): void {
  if (!sameRegion(action.region, expectedRegion)) {
    addIssue(ctx, [...path, "region"], "An action must sit in the region that contains it.");
  }
  action.rects.forEach((rect, rectIndex) => {
    if (!rectFits(rect, width, height)) {
      addIssue(ctx, [...path, "rects", rectIndex], "An action rectangle must stay inside its region.");
    }
  });
  if (action.action.type === "select-page") {
    if (!pageIds.has(action.action.pageId)) {
      addIssue(ctx, [...path, "action", "pageId"], "A page action must reference a bundle page.");
    }
    const previousPageId = action.action.previousPageId;
    if (previousPageId !== null && !pageIds.has(previousPageId)) {
      addIssue(ctx, [...path, "action", "previousPageId"], "A previous page must be a bundle page.");
    }
  }
  if (action.action.type === "vote" && itemIds && !itemIds.has(action.action.itemId)) {
    addIssue(ctx, [...path, "action", "itemId"], "A vote action must reference a vote slot on its page.");
  }
}

/** Check bundle consistency that individual object schemas cannot express. */
function refineRenderBundle(bundle: RenderBundle, ctx: z.RefinementCtx): void {
  const regionWidth = computeRegionWidth(
    bundle.designId,
    bundle.profile.contentWidth,
    bundle.profile.scrollbarGutter,
  );
  if (!nearlyEqual(bundle.header.width, regionWidth)) {
    addIssue(ctx, ["header", "width"], "The header width must match the profile region width.");
  }

  const pageIds = new Set<string>();
  bundle.pages.forEach((page, pageIndex) => {
    if (pageIds.has(page.pageId)) {
      addIssue(ctx, ["pages", pageIndex, "pageId"], `Duplicate page id "${page.pageId}".`);
    }
    pageIds.add(page.pageId);
  });

  validateStrips(
    bundle.header.strips,
    bundle.header.width,
    bundle.header.height,
    bundle.profile.rasterScale,
    bundle.profile.maxTextureWidth,
    bundle.profile.maxTextureHeight,
    ["header", "strips"],
    ctx,
  );
  bundle.header.actions.forEach((action, actionIndex) => {
    validateAction(
      action,
      { kind: "header" },
      bundle.header.width,
      bundle.header.height,
      pageIds,
      undefined,
      ["header", "actions", actionIndex],
      ctx,
    );
  });
  bundle.header.tabs.forEach((tab, tabIndex) => {
    if (!pageIds.has(tab.pageId)) {
      addIssue(ctx, ["header", "tabs", tabIndex, "pageId"], "A tab must reference a bundle page.");
    }
    if (!rectFits(tab.rect, bundle.header.width, bundle.header.height)) {
      addIssue(ctx, ["header", "tabs", tabIndex, "rect"], "A tab rectangle must stay inside the header.");
    }
  });

  bundle.pages.forEach((page, pageIndex) => {
    const pagePath: BundlePath = ["pages", pageIndex];
    if (!nearlyEqual(page.width, regionWidth)) {
      addIssue(ctx, [...pagePath, "width"], "A page width must match the profile region width.");
    }
    if (!nearlyEqual(page.contentWidth, bundle.profile.contentWidth)) {
      addIssue(ctx, [...pagePath, "contentWidth"], "A page content width must match the profile.");
    }
    if (!nearlyEqual(page.scrollbarGutter, bundle.profile.scrollbarGutter)) {
      addIssue(ctx, [...pagePath, "scrollbarGutter"], "A page scrollbar gutter must match the profile.");
    }

    validateStrips(
      page.strips,
      page.width,
      page.height,
      bundle.profile.rasterScale,
      bundle.profile.maxTextureWidth,
      bundle.profile.maxTextureHeight,
      [...pagePath, "strips"],
      ctx,
    );

    const itemIds = new Set<string>();
    page.voteSlots.forEach((slot, slotIndex) => {
      const slotPath: BundlePath = [...pagePath, "voteSlots", slotIndex];
      itemIds.add(slot.itemId);
      if (!sameRegion(slot.region, { kind: "page", pageId: page.pageId })) {
        addIssue(ctx, [...slotPath, "region"], "A vote slot must sit in its page region.");
      }
      if (!rectFits(slot.rect, page.width, page.height)) {
        addIssue(ctx, [...slotPath, "rect"], "A vote slot rectangle must stay inside its page.");
      }
      const icons = newspaperVoteIconAssets[bundle.designId][slot.value];
      if (slot.neutralAssetId !== icons.neutral || slot.selectedAssetId !== icons.selected) {
        addIssue(ctx, slotPath, "Vote icons must match the publication design and vote direction.");
      }
    });

    page.actions.forEach((action, actionIndex) => {
      validateAction(
        action,
        { kind: "page", pageId: page.pageId },
        page.width,
        page.height,
        pageIds,
        itemIds,
        [...pagePath, "actions", actionIndex],
        ctx,
      );
    });
  });
}

/** Parse and validate a saved render bundle before cache publication or reuse. */
export function validateRenderBundle(input: unknown): RenderBundle {
  const bundle = renderBundleSchema.parse(input);
  validateRenderProfileForDesign(bundle.profile, bundle.designId);
  return bundle;
}
