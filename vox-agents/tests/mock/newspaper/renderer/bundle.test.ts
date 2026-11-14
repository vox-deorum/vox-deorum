/** Verify bounded render bundle validation and safe asset references. */
import { describe, expect, it } from "vitest";
import { createNewspaperBundle, newspaperTestProfile as profile, newspaperTestRegionWidth as regionWidth } from "../../../helpers/newspaper-fixtures.js";
import { validateRenderBundle } from "../../../../src/newspaper/renderer/bundle.js";
import { newspaperRendererVersion, type RenderBundle, type RenderStrip } from "../../../../src/newspaper/renderer/types.js";

/** Build one full-width strip whose pixels match the supplied CSS size. */
function createStrip(
  index: number,
  fileName: string,
  width: number,
  y: number,
  visibleHeight: number,
): RenderStrip {
  return {
    index,
    fileName,
    clip: { x: 0, y, width, height: visibleHeight },
    visibleHeight,
    pixelWidth: Math.round(width * profile.rasterScale),
    pixelHeight: Math.round(visibleHeight * profile.rasterScale),
  };
}

/** Build a complete bundle for the controlled modern profile. */
function createBundle(): RenderBundle {
  return {
    ...createNewspaperBundle(),
    header: {
      width: regionWidth,
      height: 40,
      strips: [createStrip(0, "header-0.dds", regionWidth, 0, 40)],
      actions: [
        {
          actionId: "header-front",
          region: { kind: "header" },
          action: {
            type: "select-page",
            pageId: "front",
            previousPageId: null,
          },
          rects: [{ x: 8, y: 8, width: 48, height: 16 }],
        },
      ],
      tabs: [
        {
          pageId: "front",
          label: "Front",
          rect: { x: 8, y: 24, width: 48, height: 12 },
        },
      ],
    },
    pages: [
      {
        pageId: "front",
        layout: "ordinary",
        width: regionWidth,
        height: 40,
        contentHeight: 40,
        contentWidth: profile.contentWidth,
        scrollbarGutter: profile.scrollbarGutter,
        strips: [createStrip(0, "page-0.dds", regionWidth, 0, 40)],
        actions: [
          {
            actionId: "page-front",
            region: { kind: "page", pageId: "front" },
            action: {
              type: "select-page",
              pageId: "front",
              previousPageId: null,
            },
            rects: [{ x: 8, y: 8, width: 40, height: 16 }],
          },
          {
            actionId: "vote-up",
            region: { kind: "page", pageId: "front" },
            action: {
              type: "vote",
              itemId: "shared-item",
              value: "up",
              previousValue: "none",
            },
            rects: [{ x: 60, y: 8, width: 16, height: 16 }],
          },
        ],
        voteSlots: [
          {
            itemId: "shared-item",
            value: "up",
            region: { kind: "page", pageId: "front" },
            rect: { x: 60, y: 8, width: 16, height: 16 },
            neutralAssetId: "vote-modern-up-neutral",
            selectedAssetId: "vote-modern-up-selected",
          },
        ],
      },
    ],
  };
}

describe("newspaper render bundle validation", () => {
  it("should accept a complete bundle and preserve its identity", () => {
    const bundle = createBundle();
    expect(validateRenderBundle(bundle)).toMatchObject({
      issueId: bundle.issueId,
      campaignId: bundle.campaignId,
      timelineId: bundle.timelineId,
      rendererVersion: newspaperRendererVersion,
    });
  });

  it("should reject unsupported schema, renderer, design, and identity values", () => {
    expect(() => validateRenderBundle({ ...createBundle(), schemaVersion: 2 })).toThrow();
    expect(() => validateRenderBundle({ ...createBundle(), rendererVersion: "9.9.9" })).toThrow();
    expect(() => validateRenderBundle({ ...createBundle(), designId: "tabloid" })).toThrow();
    expect(() => validateRenderBundle({ ...createBundle(), issueId: "" })).toThrow();
  });

  it("should reject profiles beyond the design width or scale limits", () => {
    expect(() =>
      validateRenderBundle({
        ...createBundle(),
        profile: { ...profile, rasterScale: 5 },
      }),
    ).toThrow();
    expect(() =>
      validateRenderBundle({
        ...createBundle(),
        profile: { ...profile, maxTextureWidth: 100 },
      }),
    ).toThrow();
  });

  it("should reject duplicate page ids", () => {
    const bundle = createBundle();
    bundle.pages.push({ ...bundle.pages[0] });
    expect(() => validateRenderBundle(bundle)).toThrow();
  });

  it("should reject strips with gaps, incomplete coverage, or wrong dimensions", () => {
    const gap = createBundle();
    gap.pages[0].strips = [
      createStrip(0, "page-a.dds", regionWidth, 0, 20),
      createStrip(1, "page-b.dds", regionWidth, 25, 15),
    ];
    expect(() => validateRenderBundle(gap)).toThrow();

    const short = createBundle();
    short.header.strips[0].visibleHeight = 20;
    expect(() => validateRenderBundle(short)).toThrow();

    const wrongWidth = createBundle();
    wrongWidth.pages[0].strips[0].pixelWidth += 4;
    expect(() => validateRenderBundle(wrongWidth)).toThrow();

    const padded = createBundle();
    padded.pages[0].strips[0].pixelHeight += 4;
    expect(() => validateRenderBundle(padded)).toThrow();

    const oversized = createBundle();
    oversized.profile.maxTextureHeight = 39;
    expect(() => validateRenderBundle(oversized)).toThrow();
  });

  it("should reject unsafe DDS asset basenames", () => {
    const stripName = createBundle();
    stripName.header.strips[0].fileName = "../../header.dds";
    expect(() => validateRenderBundle(stripName)).toThrow();

    const iconName = createBundle();
    iconName.pages[0].voteSlots[0].neutralAssetId = "nested/icon";
    expect(() => validateRenderBundle(iconName)).toThrow();
  });

  it.each(["unknown-icon", "vote-victorian-up-neutral", "vote-modern-down-neutral"])(
    "should reject a vote icon outside the slot's design and direction: %s", (assetId) => {
      const bundle = createBundle();
      bundle.pages[0].voteSlots[0].neutralAssetId = assetId;
      expect(() => validateRenderBundle(bundle)).toThrow();
    },
  );

  it("should reject action targets and item references outside the bundle", () => {
    const target = createBundle();
    target.header.actions[0].action = {
      type: "select-page",
      pageId: "missing",
      previousPageId: null,
    };
    expect(() => validateRenderBundle(target)).toThrow();

    const item = createBundle();
    item.pages[0].actions[1].action = {
      type: "vote",
      itemId: "missing",
      value: "up",
      previousValue: "none",
    };
    expect(() => validateRenderBundle(item)).toThrow();

    const tab = createBundle();
    tab.header.tabs[0].pageId = "missing";
    expect(() => validateRenderBundle(tab)).toThrow();
  });

  it("should reject geometry outside its region or with non-finite numbers", () => {
    const foreignRegion = createBundle();
    foreignRegion.pages[0].actions[0].region = { kind: "header" };
    expect(() => validateRenderBundle(foreignRegion)).toThrow();

    const outside = createBundle();
    outside.pages[0].actions[0].rects[0].x = regionWidth;
    expect(() => validateRenderBundle(outside)).toThrow();

    const nonFinite = createBundle();
    nonFinite.pages[0].actions[0].rects[0].x = Number.POSITIVE_INFINITY;
    expect(() => validateRenderBundle(nonFinite)).toThrow();
  });
});
