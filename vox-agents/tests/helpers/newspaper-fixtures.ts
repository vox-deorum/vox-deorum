/** Shared controlled newspaper bundles for validation and cache tests. */
import type { IssueDocument } from "../../src/newspaper/contracts/issue.js";
import { computeRegionWidth } from "../../src/newspaper/renderer/layout.js";
import { newspaperRenderBundleSchemaVersion, newspaperRendererVersion, type RenderBundle, type RenderProfile, type RenderStrip } from "../../src/newspaper/renderer/types.js";

export const newspaperTestProfile: RenderProfile = {
  viewportWidth: 1024,
  viewportHeight: 768,
  contentWidth: 64,
  textScale: 1,
  rasterScale: 1,
  maxTextureWidth: 512,
  maxTextureHeight: 512,
  scrollbarGutter: 16,
};

export const newspaperTestRegionWidth = computeRegionWidth("modern", newspaperTestProfile.contentWidth, newspaperTestProfile.scrollbarGutter);

/** Build a small issue whose two pages share one item. */
export function createNewspaperIssue(): IssueDocument {
  return {
    schemaVersion: 1,
    issueId: "issue-1",
    campaignId: "campaign-1",
    timelineId: "timeline-1",
    receiver: { playerId: 0, label: "Reader" },
    cutoff: { turn: 12, label: "Turn 12" },
    publication: {
      title: "The Daily Deorum",
      designId: "modern",
      designVersion: "1",
    },
    pages: [
      {
        id: "front",
        label: "Front",
        layout: "ordinary",
        itemIds: ["shared-item"],
      },
      {
        id: "analysis",
        label: "Analysis",
        layout: "analysis",
        itemIds: ["shared-item"],
      },
    ],
    items: [
      {
        id: "shared-item",
        tags: [],
        seriesKeys: [],
        headline: [{ type: "text", text: "Shared report" }],
        body: [[{ type: "text", text: "Body" }]],
        record: [{ type: "text", text: "Record" }],
      },
    ],
  };
}

/** Build one full-width strip for the controlled profile. */
function createStrip(index: number, fileName: string): RenderStrip {
  return {
    index,
    fileName,
    clip: { x: 0, y: 0, width: newspaperTestRegionWidth, height: 40 },
    visibleHeight: 40,
    pixelWidth: Math.round(newspaperTestRegionWidth * newspaperTestProfile.rasterScale),
    pixelHeight: Math.round(40 * newspaperTestProfile.rasterScale),
  };
}

/** Build a complete single-page bundle for cache and validation tests. */
export function createNewspaperBundle(): RenderBundle {
  return {
    schemaVersion: newspaperRenderBundleSchemaVersion,
    rendererVersion: newspaperRendererVersion,
    browserVersion: "TestBrowser/1",
    issueId: "issue-1",
    campaignId: "campaign-1",
    timelineId: "timeline-1",
    designId: "modern",
    designVersion: "1",
    profile: { ...newspaperTestProfile },
    header: {
      width: newspaperTestRegionWidth,
      height: 40,
      strips: [createStrip(0, "header-0.dds")],
      actions: [],
      tabs: [],
    },
    pages: [
      {
        pageId: "front",
        layout: "ordinary",
        width: newspaperTestRegionWidth,
        height: 40,
        contentHeight: 40,
        contentWidth: newspaperTestProfile.contentWidth,
        scrollbarGutter: newspaperTestProfile.scrollbarGutter,
        strips: [createStrip(0, "page-0.dds")],
        actions: [],
        voteSlots: [],
      },
    ],
  };
}

