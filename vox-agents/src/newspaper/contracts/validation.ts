/**
 * Runtime validation for newspaper data at process and browser boundaries.
 *
 * The renderer trusts nothing that crosses a JSON, worker, or page boundary.
 * These schemas check issue references, typed links, registered assets, reader
 * state, and the fixed render profile before the renderer consumes them.
 */
import { getNewspaperAsset, isNewspaperAssetId } from "../ui/assets.js";
import { computeRegionWidth, newspaperDesignDefaults } from "../ui/layout.js";
import { z } from "zod";

import {
  newspaperDesignIds,
  newspaperIssueSchemaVersion,
  newspaperLayoutVariants,
  newspaperScreens,
  newspaperVoteValues,
  type IssueDocument,
  type ReaderAction,
  type ReaderState,
  type RenderProfile,
  type NewspaperDesignId,
} from "./types.js";

/** Schema for a typed link destination. */
export const linkTargetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("city"),
    cityId: z.string().min(1),
  }),
  z.object({
    type: z.literal("civilization"),
    civilizationId: z.string().min(1),
  }),
  z.object({
    type: z.literal("trade-relationship"),
    partnerCivilizationId: z.string().min(1),
    direction: z.enum(["import", "export", "both"]),
  }),
  z.object({
    type: z.literal("screen"),
    screen: z.enum(newspaperScreens),
  }),
  z.object({
    type: z.literal("article"),
    issueId: z.string().min(1),
    itemId: z.string().min(1),
  }),
]);

/** Schema for one inline prose node. */
export const inlineNodeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("strong"), text: z.string() }),
  z.object({ type: z.literal("emphasis"), text: z.string() }),
  z.object({ type: z.literal("break") }),
  z.object({ type: z.literal("link"), text: z.string().min(1), target: linkTargetSchema }),
]);

/** Schema for a non-empty run of inline nodes. */
export const inlineNodesSchema = z.array(inlineNodeSchema).min(1);

/** Schema for one or more paragraphs. */
export const paragraphsSchema = z.array(inlineNodesSchema).min(1);

/** Schema for a row in an evidence table. */
export const evidenceRowSchema = z.object({
  label: z.string().min(1),
  values: z.array(z.string()).min(1),
  missing: z.boolean().optional(),
});

/** Schema for an analysis evidence table. */
export const evidenceTableSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    columns: z.array(z.string().min(1)).min(2),
    rows: z.array(evidenceRowSchema).min(1),
    note: z.string().optional(),
  })
  .superRefine((table, ctx) => {
    table.rows.forEach((row, index) => {
      if (row.values.length !== table.columns.length - 1) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, "values"],
          message: `Row "${row.label}" needs one value per data column.`,
        });
      }
    });
  });

/** Schema for a link back to an earlier report. */
export const historySchema = z
  .object({
    label: z.string().min(1),
    target: linkTargetSchema,
    body: paragraphsSchema,
  })
  .superRefine((history, ctx) => {
    if (history.target.type !== "article") {
      ctx.addIssue({
        code: "custom",
        path: ["target"],
        message: "History links must target an article.",
      });
    }
  });

/** Schema for a modern feed avatar. */
export const avatarSchema = z.object({
  letter: z.string().min(1).max(2),
  tone: z.enum(["slate", "rose", "sage"]),
});

/** Schema for one published item. */
export const newspaperItemSchema = z
  .object({
    id: z.string().min(1),
    tags: z.array(z.string().min(1)),
    seriesKeys: z.array(z.string().min(1)),
    headline: inlineNodesSchema,
    deck: inlineNodesSchema.optional(),
    body: paragraphsSchema,
    record: inlineNodesSchema,
    history: historySchema.optional(),
    assetId: z.string().min(1).optional(),
    assetAlt: z.string().min(1).optional(),
    avatar: avatarSchema.optional(),
    evidence: evidenceTableSchema.optional(),
  })
  .superRefine((item, ctx) => {
    if (!item.assetId) return;
    if (!isNewspaperAssetId(item.assetId)) {
      ctx.addIssue({
        code: "custom",
        path: ["assetId"],
        message: `Unknown asset "${item.assetId}".`,
      });
      return;
    }
    const asset = getNewspaperAsset(item.assetId);
    if (asset?.kind !== "image") {
      ctx.addIssue({
        code: "custom",
        path: ["assetId"],
        message: `Asset "${item.assetId}" is not an image.`,
      });
    }
    if (!item.assetAlt) {
      ctx.addIssue({
        code: "custom",
        path: ["assetAlt"],
        message: "An item image needs alternative text.",
      });
    }
  });

/** Schema for one section page. */
export const newspaperPageSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  layout: z.enum(newspaperLayoutVariants),
  itemIds: z.array(z.string().min(1)).min(1),
});

/** Schema for the receiving player. */
export const receiverIdentitySchema = z.object({
  playerId: z.number().int().nonnegative(),
  civilizationId: z.string().min(1).optional(),
  label: z.string().min(1),
});

/** Schema for the reporting cutoff. */
export const issueCutoffSchema = z.object({
  turn: z.number().int().nonnegative(),
  label: z.string().min(1),
});

/** Schema for publication identity. */
export const publicationIdentitySchema = z
  .object({
    title: z.string().min(1),
    designId: z.enum(newspaperDesignIds),
    designVersion: z.string().min(1),
    ornamentAssetId: z.string().min(1).optional(),
  })
  .superRefine((publication, ctx) => {
    if (!publication.ornamentAssetId) return;
    if (!isNewspaperAssetId(publication.ornamentAssetId)) {
      ctx.addIssue({
        code: "custom",
        path: ["ornamentAssetId"],
        message: `Unknown ornament asset "${publication.ornamentAssetId}".`,
      });
      return;
    }
    const asset = getNewspaperAsset(publication.ornamentAssetId);
    if (asset?.kind !== "ornament") {
      ctx.addIssue({
        code: "custom",
        path: ["ornamentAssetId"],
        message: `Asset "${publication.ornamentAssetId}" is not an ornament.`,
      });
    }
  });

/** Schema for a complete issue document. */
export const issueDocumentSchema = z
  .object({
    schemaVersion: z.literal(newspaperIssueSchemaVersion),
    issueId: z.string().min(1),
    campaignId: z.string().min(1),
    timelineId: z.string().min(1),
    receiver: receiverIdentitySchema,
    cutoff: issueCutoffSchema,
    publication: publicationIdentitySchema,
    pages: z.array(newspaperPageSchema).min(1),
    items: z.array(newspaperItemSchema).min(1),
  })
  .superRefine((issue, ctx) => {
    const itemIds = new Set<string>();
    issue.items.forEach((item, index) => {
      if (itemIds.has(item.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "id"],
          message: `Duplicate item id "${item.id}".`,
        });
      }
      itemIds.add(item.id);
    });

    const pageIds = new Set<string>();
    issue.pages.forEach((page, pageIndex) => {
      if (pageIds.has(page.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", pageIndex, "id"],
          message: `Duplicate page id "${page.id}".`,
        });
      }
      pageIds.add(page.id);
      const pageItemIds = new Set<string>();
      page.itemIds.forEach((itemId, itemIndex) => {
        if (pageItemIds.has(itemId)) {
          ctx.addIssue({
            code: "custom",
            path: ["pages", pageIndex, "itemIds", itemIndex],
            message: `Duplicate item reference "${itemId}" on page "${page.id}".`,
          });
        }
        pageItemIds.add(itemId);
        if (!itemIds.has(itemId)) {
          ctx.addIssue({
            code: "custom",
            path: ["pages", pageIndex, "itemIds", itemIndex],
            message: `Page "${page.id}" references unknown item "${itemId}".`,
          });
        }
      });
    });
  });

/** Schema for one selection action. */
export const selectPageActionSchema = z.object({
  type: z.literal("select-page"),
  pageId: z.string().min(1),
  previousPageId: z.string().min(1).nullable(),
});

/** Schema for one vote action. */
export const voteActionSchema = z.object({
  type: z.literal("vote"),
  itemId: z.string().min(1),
  value: z.enum(newspaperVoteValues),
  previousValue: z.enum(newspaperVoteValues),
});

/** Schema for one link action. */
export const followLinkActionSchema = z.object({
  type: z.literal("follow-link"),
  itemId: z.string().min(1),
  target: linkTargetSchema,
});

/** Schema for every reader action. */
export const readerActionSchema = z.discriminatedUnion("type", [
  selectPageActionSchema,
  voteActionSchema,
  followLinkActionSchema,
]);

/** Schema for persisted reader state. */
export const readerStateSchema = z.object({
  activePageId: z.string().min(1),
  scrollByPage: z.record(z.string(), z.number().finite().nonnegative()),
  votes: z.record(z.string(), z.enum(newspaperVoteValues)),
});

/** Schema for a fixed export profile. */
export const renderProfileSchema = z.object({
  viewportWidth: z.number().finite().positive(),
  viewportHeight: z.number().finite().positive(),
  contentWidth: z.number().finite().positive(),
  textScale: z.number().finite().positive().max(3),
  rasterScale: z.number().finite().positive().max(4),
  maxTextureWidth: z.number().int().positive(),
  maxTextureHeight: z.number().int().positive(),
  scrollbarGutter: z.number().finite().nonnegative().max(64),
});

/** Parse an issue document or throw a validation error. */
export function parseIssueDocument(input: unknown): IssueDocument {
  return issueDocumentSchema.parse(input);
}

/** Parse a reader action or throw a validation error. */
export function parseReaderAction(input: unknown): ReaderAction {
  return readerActionSchema.parse(input);
}

/** Parse persisted reader state or throw a validation error. */
export function parseReaderState(input: unknown): ReaderState {
  return readerStateSchema.parse(input);
}

/** Parse a render profile or throw a validation error. */
export function parseRenderProfile(input: unknown): RenderProfile {
  return renderProfileSchema.parse(input);
}

/** Validate a reader action against the issue that produced it. */
export function validateReaderAction(issue: IssueDocument, input: unknown): ReaderAction {
  const action = parseReaderAction(input);
  if (action.type === "select-page") {
    if (!issue.pages.some((page) => page.id === action.pageId)) {
      throw new Error(`Unknown page "${action.pageId}".`);
    }
    return action;
  }
  if (!issue.items.some((item) => item.id === action.itemId)) {
    throw new Error(`Unknown item "${action.itemId}".`);
  }
  return action;
}

/** Validate persisted state against the pages and items of one issue. */
export function validateReaderState(issue: IssueDocument, input: unknown): ReaderState {
  const state = parseReaderState(input);
  if (!issue.pages.some((page) => page.id === state.activePageId)) {
    throw new Error(`Unknown active page "${state.activePageId}".`);
  }
  const pageIds = new Set(issue.pages.map((page) => page.id));
  for (const pageId of Object.keys(state.scrollByPage)) {
    if (!pageIds.has(pageId)) {
      throw new Error(`Scroll state references unknown page "${pageId}".`);
    }
  }
  const itemIds = new Set(issue.items.map((item) => item.id));
  for (const itemId of Object.keys(state.votes)) {
    if (!itemIds.has(itemId)) {
      throw new Error(`Vote state references unknown item "${itemId}".`);
    }
  }
  return state;
}

/** Reject a profile that cannot fit the fixed publication width in a texture. */
export function validateRenderProfileForDesign(
  profile: RenderProfile,
  designId: NewspaperDesignId,
): void {
  const regionWidth = computeRegionWidth(designId, profile.contentWidth, profile.scrollbarGutter);
  const pixelWidth = Math.ceil(regionWidth * profile.rasterScale);
  if (pixelWidth > profile.maxTextureWidth) {
    throw new Error(
      `Publication width ${pixelWidth}px exceeds the ${profile.maxTextureWidth}px texture limit.`,
    );
  }
  const defaults = newspaperDesignDefaults[designId];
  if (profile.contentWidth < defaults.paperPadding) {
    throw new Error("Content width leaves no room for the publication margins.");
  }
}
