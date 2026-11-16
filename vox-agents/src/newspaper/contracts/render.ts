/** Browser-safe render profiles, geometry, bundle contracts, and their structural schemas. */
import { z } from "zod";
import {
  newspaperDesignIds,
  newspaperLayoutVariants,
} from "./issue.js";
import { readerActionSchema } from "./reader.js";

/** Version of the exported render bundle shape. */
export const newspaperRenderBundleSchemaVersion = 2;

/** Version reported by the shared renderer. */
export const newspaperRendererVersion = "0.2.0";

/** Immutable browser capture and display settings for one export request. */
export type RenderProfile = z.infer<typeof renderProfileSchema>;

/** Physical publication space negotiated with the game after its reader chrome. */
export type NewspaperView = z.infer<typeof newspaperViewSchema>;

/** Validate the current publication viewport and the reader's requested zoom. */
export const newspaperViewSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  zoom: z.number().finite().min(0.5).max(2),
});

/** A point in CSS pixels. */
export interface Point {
  x: number;
  y: number;
}

/** A size in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/** A rectangle in CSS pixels. */
export type Rect = z.infer<typeof rectSchema>;

/** A named export region. */
export type RenderRegion = z.infer<typeof renderRegionSchema>;

/** Layout measurements shared by the reader and exporter. */
export interface RenderLayoutMetrics {
  contentWidth: number;
  paperPadding: number;
  scrollbarGutter: number;
  regionWidth: number;
  viewportWidth: number;
  viewportHeight: number;
  rasterScale: number;
  textScale: number;
  displayScale: number;
}

/** One interactive element and its CSS rectangles relative to its region. */
export type ActionGeometry = z.infer<typeof actionGeometrySchema>;

/** One tab label and its CSS rectangle relative to the header region. */
export type TabGeometry = z.infer<typeof tabGeometrySchema>;

/** One dynamic vote slot reserved in an exported image. */
export type VoteSlotGeometry = z.infer<typeof voteSlotGeometrySchema>;

/** One image strip in a saved render bundle. */
export type RenderStrip = z.infer<typeof renderStripSchema>;

/** Header portion of a saved render bundle. */
export type RenderHeaderBundle = z.infer<typeof headerBundleSchema>;

/** Page portion of a saved render bundle. */
export type RenderPageBundle = z.infer<typeof pageBundleSchema>;

/** Serializable render bundle returned by the export worker. */
export type RenderBundle = z.infer<typeof renderBundleSchema>;

/** Schema for a rectangle in CSS pixels relative to its region. */
export const rectSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

/** Schema for a header or page region reference. */
export const renderRegionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("header") }),
  z.object({ kind: z.literal("page"), pageId: z.string().min(1) }),
]);

/** Schema for one saved image strip. */
export const renderStripSchema = z.object({
  index: z.number().int().nonnegative(),
  fileName: z.string().min(1),
  clip: rectSchema,
  visibleHeight: z.number().finite().positive(),
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
});

/** Schema for one interactive element in a saved bundle. */
export const actionGeometrySchema = z.object({
  actionId: z.string().min(1),
  region: renderRegionSchema,
  action: readerActionSchema,
  rects: z.array(rectSchema),
});

/** Schema for one header tab in a saved bundle. */
export const tabGeometrySchema = z.object({
  pageId: z.string().min(1),
  label: z.string(),
  rect: rectSchema,
});

/** Schema for one dynamic vote slot in a saved bundle. */
export const voteSlotGeometrySchema = z.object({
  itemId: z.string().min(1),
  value: z.enum(["up", "down"]),
  region: renderRegionSchema,
  rect: rectSchema,
  neutralAssetId: z.string().min(1),
  selectedAssetId: z.string().min(1),
});

/** Schema for a publication's capture and display profile. */
export const renderProfileSchema = z.object({
  viewportWidth: z.number().int().positive(),
  viewportHeight: z.number().int().positive(),
  paperWidth: z.number().finite().positive(),
  displayScale: z.number().finite().min(0.5).max(2),
  textScale: z.number().finite().positive().max(3),
  rasterScale: z.number().finite().positive().max(4),
  maxTextureWidth: z.number().int().positive(),
  maxTextureHeight: z.number().int().positive(),
  scrollbarGutter: z.number().finite().nonnegative().max(64),
});

/** Schema for the masthead and tab portion of a bundle. */
export const headerBundleSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  strips: z.array(renderStripSchema).min(1),
  actions: z.array(actionGeometrySchema),
  tabs: z.array(tabGeometrySchema),
});

/** Schema for one expanded page section in a bundle. */
export const pageBundleSchema = z.object({
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

/** Structural schema for the complete serialized render bundle. */
export const renderBundleSchema = z.object({
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
});
