/** Verify newspaper contracts, bounded bundle validation, and reversible shared votes. */
import { createNewspaperBundle, newspaperTestProfile as profile, newspaperTestRegionWidth as regionWidth } from "../../../helpers/newspaper-fixtures.js";
import { describe, expect, it } from "vitest";

import { validateRenderBundle } from "../../../../src/newspaper/contracts/bundle.js";
import {
  createReaderState,
  getVote,
  normalizeReaderState,
  setPageScroll,
  toggleVote,
} from "../../../../src/newspaper/ui/state.js";
import {
  newspaperRendererVersion,
  type IssueDocument,
  type RenderBundle,
  type RenderStrip,
} from "../../../../src/newspaper/contracts/types.js";
import { parseIssueDocument } from "../../../../src/newspaper/contracts/validation.js";

/** Build a small issue whose two pages share one item. */
function createIssue(): IssueDocument {
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

describe("newspaper issue contracts", () => {
  it("should allow sharing an item across pages but reject repeats within a page", () => {
    const issue = createIssue();
    expect(parseIssueDocument(issue).pages).toHaveLength(2);
    issue.pages[0].itemIds.push(issue.pages[0].itemIds[0]);
    expect(() => parseIssueDocument(issue)).toThrow();
  });
  it("should reject a page that references an unknown item", () => {
    const issue = createIssue();
    issue.pages[0].itemIds = ["missing-item"];
    expect(() => parseIssueDocument(issue)).toThrow();
  });
});

describe("newspaper shared vote state", () => {
  it("should preserve valid identifiers that match object prototype properties", () => {
    const issue = createIssue();
    issue.pages[0].id = "__proto__";
    issue.pages[0].itemIds = ["constructor"];
    issue.pages[1].itemIds = ["constructor"];
    issue.items[0].id = "constructor";
    const initial = createReaderState(parseIssueDocument(issue), {
      scrollByPage: JSON.parse('{"__proto__":37}'),
      votes: JSON.parse('{"constructor":"up"}'),
    });
    expect(initial.scrollByPage["__proto__"]).toBe(37);
    expect(getVote(initial, "constructor")).toBe("up");
    const cleared = toggleVote(initial, "constructor", "up");
    expect(getVote(cleared, "constructor")).toBe("none");
    expect(getVote(cleared, "toString")).toBe("none");
    expect(setPageScroll(cleared, "__proto__", 81).scrollByPage["__proto__"]).toBe(81);
  });
  it("should keep one reversible vote for an item shared by two pages", () => {
    const issue = createIssue();
    const initial = createReaderState(issue);
    const up = toggleVote(initial, "shared-item", "up");
    expect(getVote(up, "shared-item")).toBe("up");

    const analysis = normalizeReaderState(issue, {
      ...up,
      activePageId: "analysis",
    });
    expect(analysis.activePageId).toBe("analysis");
    expect(getVote(analysis, "shared-item")).toBe("up");

    const cleared = toggleVote(analysis, "shared-item", "up");
    expect(getVote(cleared, "shared-item")).toBe("none");

    const down = toggleVote(up, "shared-item", "down");
    expect(getVote(down, "shared-item")).toBe("down");
  });
});

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
