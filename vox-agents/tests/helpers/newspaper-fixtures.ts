/** Shared controlled newspaper bundles for validation and cache tests. */
import { computeRegionWidth } from "../../src/newspaper/ui/layout.js";
import { newspaperRenderBundleSchemaVersion, newspaperRendererVersion, type RenderBundle, type RenderProfile, type RenderStrip } from "../../src/newspaper/contracts/types.js";

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

