/** Browser-safe render profiles, geometry, export bridge, and bundle types. */
import type { NewspaperDesignId, NewspaperLayoutVariant } from "../contracts/issue.js";
import type { ReaderAction } from "../contracts/reader.js";

/** Version of the exported render bundle shape. */
export const newspaperRenderBundleSchemaVersion = 1;

/** Version reported by the shared renderer. */
export const newspaperRendererVersion = "0.1.0";

/** Fixed browser profile used for one export batch. */
export interface RenderProfile {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  textScale: number;
  rasterScale: number;
  maxTextureWidth: number;
  maxTextureHeight: number;
  scrollbarGutter: number;
}

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
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A named export region. */
export type RenderRegion = { kind: "header" } | { kind: "page"; pageId: string };

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
}

/** One interactive element and its CSS rectangles relative to its region. */
export interface ActionGeometry {
  actionId: string;
  region: RenderRegion;
  action: ReaderAction;
  rects: Rect[];
}

/** One tab label and its CSS rectangle relative to the header region. */
export interface TabGeometry {
  pageId: string;
  label: string;
  rect: Rect;
}

/** One dynamic vote slot reserved in an exported image. */
export interface VoteSlotGeometry {
  itemId: string;
  value: "up" | "down";
  region: RenderRegion;
  rect: Rect;
  neutralAssetId: string;
  selectedAssetId: string;
}

/** One vertical capture slice in CSS pixels relative to a region origin. */
export interface CaptureStrip {
  index: number;
  clip: Rect;
  visibleHeight: number;
  pixelWidth: number;
  pixelHeight: number;
}

/** Capture geometry for a header or page region. */
export interface CapturePlan {
  origin: Point;
  size: Size;
  strips: CaptureStrip[];
}

/** Measurement returned for the masthead and tab region. */
export interface HeaderMeasurement {
  region: { kind: "header" };
  layout: RenderLayoutMetrics;
  capture: CapturePlan;
  actions: ActionGeometry[];
  tabs: TabGeometry[];
}

/** Measurement returned for one expanded page section. */
export interface PageMeasurement {
  region: { kind: "page"; pageId: string };
  layout: RenderLayoutMetrics;
  capture: CapturePlan;
  contentHeight: number;
  actions: ActionGeometry[];
  voteSlots: VoteSlotGeometry[];
}

/** Values returned when the export bridge finishes mounting an issue. */
export interface ExportMountResult {
  rendererVersion: string;
  issueId: string;
  campaignId: string;
  timelineId: string;
  designId: NewspaperDesignId;
  designVersion: string;
  pageIds: string[];
  layout: RenderLayoutMetrics;
}

/** Fixed browser entry point used by the Node export worker. */
export interface NewspaperExportBridge {
  mount(issue: unknown, profile: unknown): Promise<ExportMountResult>;
  measureHeader(): Promise<HeaderMeasurement>;
  selectPage(pageId: string): Promise<void>;
  measurePage(): Promise<PageMeasurement>;
  mountVoteIcon(assetId: string): Promise<void>;
  dispose(): void;
}

/** One image strip in a saved render bundle. */
export interface RenderStrip {
  index: number;
  fileName: string;
  clip: Rect;
  visibleHeight: number;
  pixelWidth: number;
  pixelHeight: number;
}

/** Header portion of a saved render bundle. */
export interface RenderHeaderBundle {
  width: number;
  height: number;
  strips: RenderStrip[];
  actions: ActionGeometry[];
  tabs: TabGeometry[];
}

/** Page portion of a saved render bundle. */
export interface RenderPageBundle {
  pageId: string;
  layout: NewspaperLayoutVariant;
  width: number;
  height: number;
  contentHeight: number;
  contentWidth: number;
  scrollbarGutter: number;
  strips: RenderStrip[];
  actions: ActionGeometry[];
  voteSlots: VoteSlotGeometry[];
}

/** Serializable render bundle returned by the export worker. */
export interface RenderBundle {
  schemaVersion: number;
  rendererVersion: string;
  browserVersion: string;
  issueId: string;
  campaignId: string;
  timelineId: string;
  designId: NewspaperDesignId;
  designVersion: string;
  profile: RenderProfile;
  header: RenderHeaderBundle;
  pages: RenderPageBundle[];
}
