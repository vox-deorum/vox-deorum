/**
 * Shared newspaper contracts and schema values.
 *
 * This module is imported by the Node backend and the browser reader. Keep it
 * free of Node and DOM imports so both type checks can use it.
 */

/** Version of the stored issue document shape. */
export const newspaperIssueSchemaVersion = 1;

/** Version of the exported render bundle shape. */
export const newspaperRenderBundleSchemaVersion = 1;

/** Version reported by the shared renderer. */
export const newspaperRendererVersion = "0.1.0";

/** Visual designs supported by the shared renderer. */
export const newspaperDesignIds = ["victorian", "modern"] as const;

/** Layout variants available for a page. */
export const newspaperLayoutVariants = ["ordinary", "breaking", "analysis"] as const;

/** Vote values kept in reader state. */
export const newspaperVoteValues = ["up", "down", "none"] as const;

/** Link destinations that the renderer can emit without arbitrary URLs. */
export const newspaperLinkTargetTypes = [
  "city",
  "civilization",
  "trade-relationship",
  "screen",
  "article",
] as const;

/** Game screens that a typed link may request. */
export const newspaperScreens = [
  "city",
  "trade",
  "culture",
  "diplomacy",
  "military",
  "map",
] as const;

/** Reader action kinds. */
export const newspaperActionTypes = ["select-page", "vote", "follow-link"] as const;

/** Human labels for supported game screens. */
export const newspaperScreenLabels: Record<SupportedScreen, string> = {
  city: "City screen",
  trade: "Trade screen",
  culture: "Culture screen",
  diplomacy: "Diplomacy screen",
  military: "Military screen",
  map: "Map",
};

/** Design identifiers. */
export type NewspaperDesignId = (typeof newspaperDesignIds)[number];

/** Page layout identifiers. */
export type NewspaperLayoutVariant = (typeof newspaperLayoutVariants)[number];

/** A reversible coverage preference. */
export type VoteValue = (typeof newspaperVoteValues)[number];

/** A game screen that a link may request. */
export type SupportedScreen = (typeof newspaperScreens)[number];

/** A typed destination for a link in article prose or a history action. */
export type LinkTarget =
  | { type: "city"; cityId: string }
  | { type: "civilization"; civilizationId: string }
  | {
      type: "trade-relationship";
      partnerCivilizationId: string;
      direction: "import" | "export" | "both";
    }
  | { type: "screen"; screen: SupportedScreen }
  | { type: "article"; issueId: string; itemId: string };

/** Inline content that the renderer turns into text nodes and elements. */
export type InlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "emphasis"; text: string }
  | { type: "break" }
  | { type: "link"; text: string; target: LinkTarget };

/** One row in an analysis evidence table. */
export interface EvidenceRow {
  label: string;
  values: string[];
  missing?: boolean;
}

/** A compact evidence table shown by the analysis layout. */
export interface EvidenceTable {
  title: string;
  description: string;
  columns: string[];
  rows: EvidenceRow[];
  note?: string;
}

/** A link back to an earlier report. */
export interface NewspaperHistory {
  label: string;
  target: LinkTarget;
  body: InlineNode[][];
}

/** A short label and color tone for the modern feed avatar. */
export interface NewspaperAvatar {
  letter: string;
  tone: "slate" | "rose" | "sage";
}

/** One published item. Editorial metadata stays out of the reading surface. */
export interface NewspaperItem {
  id: string;
  tags: string[];
  seriesKeys: string[];
  headline: InlineNode[];
  deck?: InlineNode[];
  body: InlineNode[][];
  record: InlineNode[];
  history?: NewspaperHistory;
  assetId?: string;
  assetAlt?: string;
  avatar?: NewspaperAvatar;
  evidence?: EvidenceTable;
}

/** One section tab and its selected items. */
export interface NewspaperPage {
  id: string;
  label: string;
  layout: NewspaperLayoutVariant;
  itemIds: string[];
}

/** Identity of the receiving player. */
export interface ReceiverIdentity {
  playerId: number;
  civilizationId?: string;
  label: string;
}

/** Reporting cutoff for the issue. */
export interface IssueCutoff {
  turn: number;
  label: string;
}

/** Publication identity and selected design. */
export interface PublicationIdentity {
  title: string;
  designId: NewspaperDesignId;
  designVersion: string;
  ornamentAssetId?: string;
}

/** A complete issue as stored by the editor and accepted by the renderer. */
export interface IssueDocument {
  schemaVersion: number;
  issueId: string;
  campaignId: string;
  timelineId: string;
  receiver: ReceiverIdentity;
  cutoff: IssueCutoff;
  publication: PublicationIdentity;
  pages: NewspaperPage[];
  items: NewspaperItem[];
}

/** Actions emitted by the shared browser reader. */
export type ReaderAction =
  | { type: "select-page"; pageId: string; previousPageId: string | null }
  | { type: "vote"; itemId: string; value: VoteValue; previousValue: VoteValue }
  | { type: "follow-link"; itemId: string; target: LinkTarget };

/** Reading state owned by the reader and persisted by its host. */
export interface ReaderState {
  activePageId: string;
  scrollByPage: Record<string, number>;
  votes: Record<string, VoteValue>;
}

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

