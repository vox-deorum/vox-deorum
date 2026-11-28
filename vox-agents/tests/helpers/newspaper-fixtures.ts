/** Shared controlled newspaper bundles for validation and cache tests. */
import { newspaperIssueSchemaVersion, type IssueDocument } from "../../src/newspaper/contracts/issue.js";
import { computeRenderLayout } from "../../src/newspaper/renderer/layout.js";
import { newspaperRenderBundleSchemaVersion, newspaperRendererVersion, type RenderBundle, type RenderProfile, type RenderStrip } from "../../src/newspaper/contracts/render.js";

export const newspaperTestProfile: RenderProfile = {
  viewportWidth: 1024,
  viewportHeight: 768,
  paperWidth: 144,
  displayScale: 1,
  textScale: 1,
  rasterScale: 1,
  maxTextureWidth: 512,
  maxTextureHeight: 512,
  scrollbarGutter: 16,
};

export const newspaperTestRegionWidth = newspaperTestProfile.paperWidth;
export const newspaperTestContentWidth = computeRenderLayout("feed", newspaperTestProfile).contentWidth;

/** Build a small reader issue with one article on each tab. */
export function createNewspaperIssue(): IssueDocument {
  return {
    schemaVersion: newspaperIssueSchemaVersion,
    issueId: "issue-1",
    campaignId: "campaign-1",
    timelineId: "timeline-1",
    receiver: { playerId: 0, label: "Reader" },
    cutoff: { turn: 12, label: "Turn 12" },
    publication: {
      title: "The Daily Deorum",
      designId: "endless-scroll",
      designVersion: "1",
      presentation: { schemaVersion: 1, rendererFamily: "feed" },
    },
    pages: [
      {
        id: "front",
        label: "Front",
        layout: "ordinary",
        hasLead: true,
        itemIds: ["shared-item"],
      },
      {
        id: "analysis",
        label: "Analysis",
        layout: "analysis",
        hasLead: true,
        itemIds: ["analysis-item"],
      },
    ],
    items: [
      {
        id: "shared-item",
        tags: [],
        seriesKeys: [],
        headline: [{ type: "text", text: "Front page report" }],
        body: [[{ type: "text", text: "Body" }]],
        sourceNote: [{ type: "text", text: "Source observation" }],
      },
      {
        id: "analysis-item",
        tags: [],
        seriesKeys: [],
        headline: [{ type: "text", text: "Analysis report" }],
        body: [[{ type: "text", text: "Analysis body" }]],
        sourceNote: [{ type: "text", text: "Source observation" }],
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
    designId: "feed",
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
        contentWidth: newspaperTestContentWidth,
        scrollbarGutter: newspaperTestProfile.scrollbarGutter,
        strips: [createStrip(0, "page-0.dds")],
        actions: [],
        voteSlots: [],
      },
    ],
  };
}

