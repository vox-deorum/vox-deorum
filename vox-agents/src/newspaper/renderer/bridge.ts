/** Browser export bridge, measurement, and capture types. */
import type { RendererFamily } from "../contracts/design.js";
import type {
  ActionGeometry,
  Point,
  Rect,
  RenderLayoutMetrics,
  Size,
  TabGeometry,
  VoteSlotGeometry,
} from "../contracts/render.js";

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
  designId: RendererFamily;
  designVersion: string;
  pageIds: string[];
  layout: RenderLayoutMetrics;
}

/** Fixed browser entry point used by the Node export worker. */
export interface NewspaperExportBridge {
  mount(issue: unknown, profile: unknown): Promise<ExportMountResult>;
  measureHeader(): Promise<HeaderMeasurement>;
  measurePage(): Promise<PageMeasurement>;
  selectPage(pageId: string): Promise<void>;
  mountVoteIcon(assetId: string): Promise<void>;
  dispose(): void;
}
