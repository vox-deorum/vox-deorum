/** Publication data and structural validation shared by producers and readers. */
import { z } from "zod";

/** Version of the stored issue document shape. */
export const newspaperIssueSchemaVersion = 1;

/** Visual designs supported by the shared renderer. */
export const newspaperDesignIds = ["victorian", "modern"] as const;

/** Layout variants available for a page. */
export const newspaperLayoutVariants = ["ordinary", "breaking", "analysis"] as const;

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
export const newspaperItemSchema = z.object({
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
export const publicationIdentitySchema = z.object({
  title: z.string().min(1),
  designId: z.enum(newspaperDesignIds),
  designVersion: z.string().min(1),
  ornamentAssetId: z.string().min(1).optional(),
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
