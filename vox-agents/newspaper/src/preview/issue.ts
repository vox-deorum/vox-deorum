/** Sample editions built from the catalogue without running the editor. */
import { z } from "zod";
import {
  issueDocumentSchema,
  issuePublicationSchema,
  newspaperLayoutVariantSchema,
  type IssueDocument,
  type NewspaperLayoutVariant,
} from "../../../src/newspaper/contracts/issue.js";
import { readBuiltInDesignDocuments } from "../design-assets-source.js";
import ordinaryFixture from "../../fixtures/victorian-ordinary.json";
import breakingFixture from "../../fixtures/victorian-breaking.json";
import analysisFixture from "../../fixtures/victorian-analysis.json";
import pages from "../../pages.json";

const previewDesignSchema = issuePublicationSchema.omit({ designId: true, designVersion: true }).extend({
  id: z.string().min(1),
  version: z.string().min(1),
  layouts: z.array(z.object({ variant: newspaperLayoutVariantSchema })).min(1),
  pageLabels: z.record(z.string(), z.string()).default({}),
  assetDefinitions: z.array(z.object({ id: z.string().min(1), kind: z.string() })).default([]),
});

type PreviewDesign = z.infer<typeof previewDesignSchema>;

const samples: Record<NewspaperLayoutVariant, IssueDocument> = {
  ordinary: issueDocumentSchema.parse(ordinaryFixture),
  breaking: issueDocumentSchema.parse(breakingFixture),
  analysis: issueDocumentSchema.parse(analysisFixture),
};
const previewPages = [...pages].sort((a, b) => a.order - b.order);

/** Load every built-in design with the fields needed by the preview. */
export function readPreviewDesigns(): PreviewDesign[] {
  return readBuiltInDesignDocuments().flatMap(document => z.array(previewDesignSchema).parse(document));
}

/** Use fixture stories and the current design's masthead, section labels and lead artwork, with an optional accent override. */
export function createPreviewIssue(design: PreviewDesign, layout: NewspaperLayoutVariant, accentColor?: string): IssueDocument {
  const sample = samples[layout];
  const itemIds = sample.pages[0].itemIds;
  const image = design.assetDefinitions.find(asset => asset.kind === "image");
  return {
    ...sample,
    issueId: `preview-${design.id}-${layout}`,
    publication: {
      title: design.title,
      motto: design.motto,
      designId: design.id,
      designVersion: design.version,
      presentation: accentColor
        ? { ...design.presentation, tokens: { ...design.presentation.tokens, accentColor } }
        : design.presentation,
    },
    pages: previewPages.map(page => {
      const isFront = "front" in page && page.front === true;
      return {
        id: page.id,
        label: Object.hasOwn(design.pageLabels, page.id) ? design.pageLabels[page.id] : page.label,
        layout: isFront ? layout : "ordinary",
        itemIds: isFront || itemIds.length < 2 ? itemIds : itemIds.slice(1),
      };
    }),
    items: sample.items.map(item => ({
      ...item,
      image: image && item.id === itemIds[0]
        ? { assetId: `${design.id}.${image.id}`, altText: "Sample illustration" }
        : undefined,
    })),
  };
}
