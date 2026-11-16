/** Publication data and structural validation shared by producers and readers. */
import { z } from "zod";
import { presentationSchema } from "./design.js";

/** Version of the stored issue document shape. */
export const newspaperIssueSchemaVersion = 2;

/** Layout variants available for a page. */
export const newspaperLayoutVariants = ["ordinary", "breaking", "analysis"] as const;

/** Game screens that a typed link may request. */
export const newspaperScreens = ["city", "trade", "culture", "diplomacy", "military", "map"] as const;

/** Trade flows that a relationship link may select. */
export const newspaperTradeDirections = ["import", "export", "both"] as const;

/** Color tones available for a modern feed avatar. */
export const newspaperAvatarTones = ["slate", "rose", "sage"] as const;

/** Human labels for supported game screens. */
export const newspaperScreenLabels: Record<NewspaperScreen, string> = {
  /** Label for the city destination. */
  city: "City screen",
  /** Label for the trade destination. */
  trade: "Trade screen",
  /** Label for the culture destination. */
  culture: "Culture screen",
  /** Label for the diplomacy destination. */
  diplomacy: "Diplomacy screen",
  /** Label for the military destination. */
  military: "Military screen",
  /** Label for the map destination. */
  map: "Map",
};

/** Schema for a page layout identifier. */
export const newspaperLayoutVariantSchema = z.enum(newspaperLayoutVariants);
/** A page layout identifier. */
export type NewspaperLayoutVariant = z.infer<typeof newspaperLayoutVariantSchema>;

/** Schema for a game screen destination. */
export const newspaperScreenSchema = z.enum(newspaperScreens);
/** A game screen destination. */
export type NewspaperScreen = z.infer<typeof newspaperScreenSchema>;

/** Schema for a trade flow selection. */
export const newspaperTradeDirectionSchema = z.enum(newspaperTradeDirections);
/** A trade flow selection. */
export type NewspaperTradeDirection = z.infer<typeof newspaperTradeDirectionSchema>;

/** Schema for a modern feed avatar tone. */
export const newspaperAvatarToneSchema = z.enum(newspaperAvatarTones);
/** A modern feed avatar tone. */
export type NewspaperAvatarTone = z.infer<typeof newspaperAvatarToneSchema>;

/** Schema for a link to an article in a published issue. */
export const articleLinkTargetSchema = z.object({
  /** Identifies an article destination. */
  type: z.literal("article"),
  /** Issue containing the destination article. */
  issueId: z.string().min(1),
  /** Item containing the destination article. */
  itemId: z.string().min(1),
});
/** A link to an article in a published issue. */
export type ArticleLinkTarget = z.infer<typeof articleLinkTargetSchema>;

/** Schema for a typed destination for a prose link or an earlier report. */
export const linkTargetSchema = z.discriminatedUnion("type", [
  /** Open a city. */
  z.object({
    /** Identifies the destination kind. */
    type: z.literal("city"),
    /** City to open. */
    cityId: z.string().min(1),
  }),
  /** Open a civilization. */
  z.object({
    /** Identifies the destination kind. */
    type: z.literal("civilization"),
    /** Civilization to open. */
    civilizationId: z.string().min(1),
  }),
  /** Inspect trade with a partner civilization. */
  z.object({
    /** Identifies the destination kind. */
    type: z.literal("trade-relationship"),
    /** Civilization on the other side of the relationship. */
    partnerCivilizationId: z.string().min(1),
    /** Trade flows to inspect. */
    direction: newspaperTradeDirectionSchema,
  }),
  /** Open a supported game screen. */
  z.object({
    /** Identifies the destination kind. */
    type: z.literal("screen"),
    /** Screen to open. */
    screen: newspaperScreenSchema,
  }),
  /** Open an article from a published issue. */
  articleLinkTargetSchema,
]);
/** A typed destination for a prose link or an earlier report. */
export type LinkTarget = z.infer<typeof linkTargetSchema>;

/** Schema for inline content rendered as text nodes and elements. */
export const inlineNodeSchema = z.discriminatedUnion("type", [
  /** Plain text. */
  z.object({
    /** Identifies the inline content kind. */
    type: z.literal("text"),
    /** Text to display. */
    text: z.string(),
  }),
  /** Strongly emphasized text. */
  z.object({
    /** Identifies the inline content kind. */
    type: z.literal("strong"),
    /** Text to display. */
    text: z.string(),
  }),
  /** Emphasized text. */
  z.object({
    /** Identifies the inline content kind. */
    type: z.literal("emphasis"),
    /** Text to display. */
    text: z.string(),
  }),
  /** A line break within prose. */
  z.object({
    /** Identifies the inline content kind. */
    type: z.literal("break"),
  }),
  /** Text linked to a typed destination. */
  z.object({
    /** Identifies the inline content kind. */
    type: z.literal("link"),
    /** Text to display. */
    text: z.string().min(1),
    /** Destination to open. */
    target: linkTargetSchema,
  }),
]);
/** Inline content rendered as text nodes and elements. */
export type InlineNode = z.infer<typeof inlineNodeSchema>;

/** Schema for a non-empty run of inline nodes. */
export const inlineTextSchema = z.array(inlineNodeSchema).min(1);
/** A non-empty run of inline nodes. */
export type InlineText = z.infer<typeof inlineTextSchema>;

/** Schema for one or more paragraphs of inline text. */
export const paragraphsSchema = z.array(inlineTextSchema).min(1);
/** One or more paragraphs of inline text. */
export type Paragraphs = z.infer<typeof paragraphsSchema>;

/** Schema for one row in an analysis evidence table. */
export const evidenceRowSchema = z.object({
  /** Heading for this row. */
  label: z.string().min(1),
  /** One displayed value per data column. */
  values: z.array(z.string()).min(1),
  /** Whether the row contains unavailable observations. */
  hasMissingValues: z.boolean().optional(),
});
/** One row in an analysis evidence table. */
export type EvidenceRow = z.infer<typeof evidenceRowSchema>;

/** Schema for a compact evidence table shown by the analysis layout. */
export const evidenceTableSchema = z
  .object({
    /** Title displayed above the table. */
    title: z.string().min(1),
    /** Description of the values being compared. */
    description: z.string().min(1),
    /** Column headings, starting with the row heading column. */
    columns: z.array(z.string().min(1)).min(2),
    /** Observations displayed in the table. */
    rows: z.array(evidenceRowSchema).min(1),
    /** Optional explanation below the table. */
    footnote: z.string().optional(),
  })
  // Require one row value per data column.
  .superRefine((table, ctx) => {
    // Check each row against the shared column headings.
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
/** A compact evidence table shown by the analysis layout. */
export type EvidenceTable = z.infer<typeof evidenceTableSchema>;

/** Schema for a link back to an earlier report with its summary. */
export const earlierReportLinkSchema = z.object({
  /** Visible label for the earlier report link. */
  label: z.string().min(1),
  /** Article containing the earlier report. */
  target: articleLinkTargetSchema,
  /** Summary of the earlier report for the host to display. */
  summary: paragraphsSchema,
});
/** A link back to an earlier report with its summary. */
export type EarlierReportLink = z.infer<typeof earlierReportLinkSchema>;

/** Schema for a short label and color tone for the modern feed avatar. */
export const feedAvatarSchema = z.object({
  /** One or two characters displayed in the avatar. */
  initials: z.string().min(1).max(2),
  /** Color tone used for the avatar. */
  tone: newspaperAvatarToneSchema,
});
/** A short label and color tone for the modern feed avatar. */
export type FeedAvatar = z.infer<typeof feedAvatarSchema>;

/** Schema for an item illustration and its alternative text. */
export const itemImageSchema = z.object({
  /** Asset identifier for the illustration. */
  assetId: z.string().min(1),
  /** Description for readers who cannot see the illustration. */
  altText: z.string().min(1),
});
/** An item illustration and its alternative text. */
export type ItemImage = z.infer<typeof itemImageSchema>;

/** Schema for one published item with its editorial metadata. */
export const issueItemSchema = z.object({
  /** Unique item identifier within the issue. */
  id: z.string().min(1),
  /** Editorial topic tags. */
  tags: z.array(z.string().min(1)),
  /** Keys connecting coverage across issues. */
  seriesKeys: z.array(z.string().min(1)),
  /** Main heading shown to the reader. */
  headline: inlineTextSchema,
  /** Optional supporting heading below the headline. */
  subheadline: inlineTextSchema.optional(),
  /** Article paragraphs. */
  body: paragraphsSchema,
  /** Editorial explanation of the observations supporting the item. */
  sourceNote: inlineTextSchema,
  /** Optional link and summary for earlier coverage. */
  earlierReport: earlierReportLinkSchema.optional(),
  /** Optional illustration with alternative text. */
  image: itemImageSchema.optional(),
  /** Optional avatar for the modern feed. */
  avatar: feedAvatarSchema.optional(),
  /** Optional evidence table for the analysis layout. */
  evidenceTable: evidenceTableSchema.optional(),
});
/** One published item with its editorial metadata. */
export type IssueItem = z.infer<typeof issueItemSchema>;

/** Schema for one section tab and its selected items. */
export const issuePageSchema = z.object({
  /** Unique page identifier within the issue. */
  id: z.string().min(1),
  /** Section label displayed on the page tab. */
  label: z.string().min(1),
  /** Layout used to present the selected items. */
  layout: newspaperLayoutVariantSchema,
  /** Item identifiers in reading order. */
  itemIds: z.array(z.string().min(1)).min(1),
});
/** One section tab and its selected items. */
export type IssuePage = z.infer<typeof issuePageSchema>;

/** Schema for identity of the receiving player. */
export const issueReceiverSchema = z.object({
  /** Numeric identifier of the receiving player. */
  playerId: z.number().int().nonnegative(),
  /** Optional civilization identifier for the player. */
  civilizationId: z.string().min(1).optional(),
  /** Display name of the receiving player. */
  label: z.string().min(1),
});
/** Identity of the receiving player. */
export type IssueReceiver = z.infer<typeof issueReceiverSchema>;

/** Schema for reporting cutoff for the issue. */
export const issueCutoffSchema = z.object({
  /** Last turn included in the issue. */
  turn: z.number().int().nonnegative(),
  /** Display label for the cutoff. */
  label: z.string().min(1),
});
/** Reporting cutoff for the issue. */
export type IssueCutoff = z.infer<typeof issueCutoffSchema>;

/** Schema for publication identity and selected design. */
export const issuePublicationSchema = z.object({
  /** Name displayed on the publication. */
  title: z.string().min(1),
  /** Configurable visual design identity, retained with the published issue. */
  designId: z.string().min(1),
  /** Version of the selected visual design. */
  designVersion: z.string().min(1),
  /** Immutable presentation snapshot saved with the publication. */
  presentation: presentationSchema,
});
/** Publication identity and selected design. */
export type IssuePublication = z.infer<typeof issuePublicationSchema>;

/** Schema for a complete issue as stored by the editor and accepted by the renderer. */
export const issueDocumentSchema = z
  .object({
    /** Version of the stored issue document shape. */
    schemaVersion: z.literal(newspaperIssueSchemaVersion),
    /** Identifier of this issue. */
    issueId: z.string().min(1),
    /** Campaign that produced the issue. */
    campaignId: z.string().min(1),
    /** Timeline that produced the issue. */
    timelineId: z.string().min(1),
    /** Player receiving the issue. */
    receiver: issueReceiverSchema,
    /** Last observations covered by the issue. */
    cutoff: issueCutoffSchema,
    /** Publication name and visual design. */
    publication: issuePublicationSchema,
    /** Section pages in tab order. */
    pages: z.array(issuePageSchema).min(1),
    /** Published items available to the pages. */
    items: z.array(issueItemSchema).min(1),
  })
  // Require unique identifiers and valid page references.
  .superRefine((issue, ctx) => {
    const itemIds = new Set<string>();
    // Collect item identifiers and reject duplicates.
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
    // Reject duplicate pages and invalid item selections.
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
      // Check that each selected item exists and appears once on this page.
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
/** A complete issue as stored by the editor and accepted by the renderer. */
export type IssueDocument = z.infer<typeof issueDocumentSchema>;
