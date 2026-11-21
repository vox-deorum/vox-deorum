/** Sample editions built from the catalogue without running the editor. */
import { z } from "zod";
import {
  issueDocumentSchema,
  issuePublicationSchema,
  type IssueDocument,
  type ItemImage,
  type NewspaperLayoutVariant,
} from "../../../src/newspaper/contracts/issue.js";
import { editorialLayoutSchema, editorialPageSchema, type EditorialLayout } from "../../../src/newspaper/editorial/config/layouts.js";
import { resolveMasthead } from "../../../src/newspaper/editorial/presentation/masthead.js";
import { placeArticles } from "../../../src/newspaper/editorial/presentation/placement.js";
import { readBuiltInDesignDocuments } from "../design-assets-source.js";
import ordinaryFixture from "../../fixtures/victorian-ordinary.json";
import breakingFixture from "../../fixtures/victorian-breaking.json";
import analysisFixture from "../../fixtures/victorian-analysis.json";
import pages from "../../pages.json";

const previewDesignSchema = issuePublicationSchema.omit({ designId: true, designVersion: true }).extend({
  id: z.string().min(1),
  version: z.string().min(1),
  label: z.string().trim().min(1).optional(),
  civilizationTitles: z.record(z.string(), z.string()).nullable().optional(),
  layouts: z.array(editorialLayoutSchema).min(1),
  pageLabels: z.record(z.string(), z.string()).default({}),
  assetDefinitions: z.array(z.object({ id: z.string().min(1), kind: z.string() })).default([]),
});

type PreviewDesign = z.infer<typeof previewDesignSchema>;

const samples: Record<NewspaperLayoutVariant, IssueDocument> = {
  ordinary: issueDocumentSchema.parse(ordinaryFixture),
  breaking: issueDocumentSchema.parse(breakingFixture),
  analysis: issueDocumentSchema.parse(analysisFixture),
};
const previewPages = z.array(editorialPageSchema).parse(pages);
const frontPage = previewPages.find(page => page.front)!;
const tradeIllustrations = new Map<string, ItemImage>([
  ["meiji-picture-sheet", {
    assetId: "meiji-picture-sheet.ferry",
    altText: "A boatman poles a timber ferry across a blue river below tiled roofs and a low mountain.",
  }],
  ["printer-dispatch", {
    assetId: "printer-dispatch.harbour",
    altText: "Woodcut of a sailing barge beside a stone quay and riverside warehouses.",
  }],
  ["national-review", {
    assetId: "national-review.harbor-tugs",
    altText: "Two steam tugboats seen from above in New York Harbor.",
    caption: "Two harbor tugs in New York, 1938. Photograph by Paul Vanderbilt.",
  }],
]);

/** Load every built-in design with the fields needed by the preview. */
export function readPreviewDesigns(): PreviewDesign[] {
  return readBuiltInDesignDocuments().flatMap(document => z.array(previewDesignSchema).parse(document));
}

/** Use the matching artwork for a sample issue's lead story. */
function previewIllustration(design: PreviewDesign, layout: NewspaperLayoutVariant): ItemImage | undefined {
  const tradeIllustration = tradeIllustrations.get(design.id);
  if (tradeIllustration) return layout === "breaking" ? undefined : tradeIllustration;
  const image = design.assetDefinitions.find(asset => asset.kind === "image");
  return image ? { assetId: `${design.id}.${image.id}`, altText: "Sample illustration" } : undefined;
}

/** Use fixture stories with the chosen design, sample civilization and accent. */
export function createPreviewIssue(
  design: PreviewDesign,
  layout: EditorialLayout,
  accentColor?: string,
  civilizationName?: string
): IssueDocument {
  const sample = samples[layout.variant];
  const leadId = sample.pages[0].itemIds[0];
  const image = previewIllustration(design, layout.variant);
  const name = civilizationName?.trim();
  const masthead = resolveMasthead(design, new Map(name ? [["civilization", { value: name, sources: [] }]] : []));
  if (!masthead) throw new Error(`The masthead for ${design.id} needs terms the mockup cannot supply.`);
  const placements = placeArticles({
    entries: sample.items.map(item => ({
      id: item.id, tags: item.tags, subject: item.id, urgent: layout.variant === "breaking" && item.id === leadId,
    })),
    frontPage,
    frontLayout: layout,
    sectionPages: previewPages.filter(page => !page.front),
    sectionLayouts: design.layouts,
    // Mockups do not evaluate game conditions. Use the first fitting layout with positive base weight.
    layoutWeight: option => option.weight.base,
    sectionDraw: () => 0,
  });
  const placedIds = new Set(placements.flatMap(({ itemIds }) => itemIds));
  return {
    ...sample,
    issueId: `preview-${design.id}-${layout.id}`,
    publication: {
      title: masthead.title,
      motto: masthead.motto,
      ...(design.id === "coffeehouse-essay" && { editionNumber: 12 }),
      designId: design.id,
      designVersion: design.version,
      presentation: accentColor
        ? { ...design.presentation, tokens: { ...design.presentation.tokens, accentColor } }
        : design.presentation,
    },
    pages: placements.map(({ page, layout, itemIds }) => ({
      id: page.id,
      label: Object.hasOwn(design.pageLabels, page.id) ? design.pageLabels[page.id] : page.label,
      layout: layout.variant,
      itemIds,
    })),
    items: sample.items.filter(item => placedIds.has(item.id)).map((item, index) => ({
      ...item,
      // Sample dates are illustrative; live almanacks use recorded observations.
      ...(design.id === "printed-almanack" && { observedTurn: sample.cutoff.turn - 3 * index }),
      image: item.id === leadId ? image : undefined,
    })),
  };
}
