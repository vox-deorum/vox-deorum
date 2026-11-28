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
import { readBuiltInDesignDocuments } from "../design-assets-source.js";
import breakingFixture from "../../fixtures/steam-press-broadsheet-breaking.json";
import analysisFixture from "../../fixtures/steam-press-broadsheet-analysis.json";
import ordinaryFixture from "../../fixtures/endless-scroll-ordinary.json";
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
  ["brocade-picture-news", {
    assetId: "brocade-picture-news.ferry",
    altText: "A boatman poles a timber ferry across a blue river below tiled roofs and a low mountain.",
  }],
  ["woodcut-tidings", {
    assetId: "woodcut-tidings.harbour",
    altText: "Woodcut of a sailing barge beside a stone quay and riverside warehouses.",
  }],
  ["glossy-photo-weekly", {
    assetId: "glossy-photo-weekly.harbor-tugs",
    altText: "Two steam tugboats seen from above in New York Harbor.",
    caption: "Two harbor tugs in New York, 1938. Photograph by Paul Vanderbilt.",
  }],
]);

/** Load every built-in design with the fields needed by the preview. */
export function readPreviewDesigns(): PreviewDesign[] {
  return readBuiltInDesignDocuments().flatMap(document => z.array(previewDesignSchema).parse(document));
}

/** Use the matching artwork for a sample issue's first front story. */
function previewIllustration(design: PreviewDesign, layout: NewspaperLayoutVariant): ItemImage | undefined {
  const tradeIllustration = tradeIllustrations.get(design.id);
  if (tradeIllustration) return layout === "breaking" ? undefined : tradeIllustration;
  const image = design.assetDefinitions.find(asset => asset.kind === "image");
  return image ? { assetId: `${design.id}.${image.id}`, altText: "Sample illustration" } : undefined;
}

/** Match a sample section to the catalogue page with its ID, or else the first page that takes its first story's tags. */
function previewSectionPage(sample: IssueDocument, pageIndex: number): (typeof previewPages)[number] | undefined {
  const { id, itemIds } = sample.pages[pageIndex];
  const tags = sample.items.find(item => item.id === itemIds[0])?.tags ?? [];
  const sections = previewPages.filter(page => !page.front);
  return sections.find(page => page.id === id) ?? sections.find(page => page.tags.some(tag => tags.includes(tag)));
}

/** Use fixture stories with the chosen design, sample civilization and accent. */
export function createPreviewIssue(
  design: PreviewDesign,
  layout: EditorialLayout,
  accentColor?: string,
  civilizationName?: string
): IssueDocument {
  const sample = samples[layout.variant];
  const image = previewIllustration(design, layout.variant);
  const name = civilizationName?.trim();
  const masthead = resolveMasthead(design, new Map(name ? [["civilization", { value: name, sources: [] }]] : []));
  if (!masthead) throw new Error(`The masthead for ${design.id} needs terms the mockup cannot supply.`);
  // Mockups do not evaluate game conditions. Sections use the first non-breaking layout with positive base weight.
  const sectionLayout = design.layouts.find(option => option.variant !== "breaking" && option.weight.base > 0);
  const placements = sample.pages.flatMap((samplePage, pageIndex) => {
    const page = pageIndex === 0 ? frontPage : previewSectionPage(sample, pageIndex);
    const pageLayout = pageIndex === 0 ? layout : sectionLayout;
    return page && pageLayout ? [{ page, layout: pageLayout, itemIds: samplePage.itemIds, hasLead: samplePage.hasLead }] : [];
  });
  const placedIds = new Set(placements.flatMap(({ itemIds }) => itemIds));
  // The first front story carries the artwork, whether it is a lead or a brief.
  const artworkItemId = placements[0]?.itemIds[0];
  return {
    ...sample,
    issueId: `preview-${design.id}-${layout.id}`,
    publication: {
      title: masthead.title,
      motto: masthead.motto,
      ...(design.id === "coffeehouse-half-sheet" && { editionNumber: 12 }),
      designId: design.id,
      designVersion: design.version,
      presentation: accentColor
        ? { ...design.presentation, tokens: { ...design.presentation.tokens, accentColor } }
        : design.presentation,
    },
    pages: placements.map(({ page, layout, itemIds, hasLead }) => ({
      id: page.id,
      label: Object.hasOwn(design.pageLabels, page.id) ? design.pageLabels[page.id] : page.label,
      layout: layout.variant,
      hasLead,
      itemIds,
    })),
    items: sample.items.filter(item => placedIds.has(item.id)).map((item, index) => ({
      ...item,
      // Sample dates are illustrative; published stories use recorded observations.
      observedTurn: sample.cutoff.turn - 3 * index,
      image: item.id === artworkItemId ? image : undefined,
    })),
  };
}
