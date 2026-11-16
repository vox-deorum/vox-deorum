/** Verify publication input structure without depending on presentation assets. */
import { describe, expect, it } from "vitest";
import { createNewspaperIssue } from "../../../helpers/newspaper-fixtures.js";
import { issueDocumentSchema } from "../../../../src/newspaper/contracts/issue.js";

describe("newspaper issue contracts", () => {
  it("should require the current issue format and a stored presentation for every design", () => {
    const issue = createNewspaperIssue();
    issue.publication.designId = "early-account";
    expect(issueDocumentSchema.parse(issue)).toEqual(issue);
    const { presentation: _presentation, ...publication } = issue.publication;
    expect(issueDocumentSchema.safeParse({ ...issue, publication }).success).toBe(false);
    expect(issueDocumentSchema.safeParse({ ...issue, schemaVersion: 1 }).success).toBe(false);
    expect(issueDocumentSchema.safeParse({ ...issue, schemaVersion: 99 }).success).toBe(false);
  });

  it("should allow sharing an item across pages but reject repeats within a page", () => {
    const issue = createNewspaperIssue();
    expect(issueDocumentSchema.parse(issue).pages).toHaveLength(2);
    issue.pages[0].itemIds.push(issue.pages[0].itemIds[0]);
    expect(() => issueDocumentSchema.parse(issue)).toThrow();
  });

  it("should reject a page that references an unknown item", () => {
    const issue = createNewspaperIssue();
    issue.pages[0].itemIds = ["missing-item"];
    expect(() => issueDocumentSchema.parse(issue)).toThrow();
  });

  it("should reject duplicate page and item identifiers", () => {
    const duplicatePage = createNewspaperIssue();
    duplicatePage.pages[1].id = duplicatePage.pages[0].id;
    expect(() => issueDocumentSchema.parse(duplicatePage)).toThrow();

    const duplicateItem = createNewspaperIssue();
    duplicateItem.items.push({ ...duplicateItem.items[0] });
    expect(() => issueDocumentSchema.parse(duplicateItem)).toThrow();
  });

  it("should preserve asset identifiers without requiring renderer registration", () => {
    const issue = createNewspaperIssue();
    issue.items[0].image = {
      assetId: "editor-image-awaiting-registration",
      altText: "Ships at a port",
    };
    issue.publication.presentation.assets = { ornamentAssetId: "editor-ornament-awaiting-registration" };
    const parsed = issueDocumentSchema.parse(issue);
    expect(parsed.items[0].image).toEqual(issue.items[0].image);
    expect(parsed.publication.presentation.assets).toEqual(issue.publication.presentation.assets);
  });

  it.each([
    { type: "city", cityId: "city-1" },
    { type: "civilization", civilizationId: "civilization-1" },
    { type: "trade-relationship", partnerCivilizationId: "civilization-1", direction: "both" },
    { type: "screen", screen: "map" },
    { type: "article", issueId: "issue-0" },
  ])("should reject an earlier report without a complete article destination: %j", (target) => {
    const issue = createNewspaperIssue();
    const input = {
      ...issue,
      items: [{
        ...issue.items[0],
        earlierReport: {
          label: "Earlier coverage",
          target,
          summary: [[{ type: "text", text: "Earlier observations" }]],
        },
      }],
    };
    expect(issueDocumentSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    {},
    { assetId: "modern-port" },
    { altText: "Ships at a port" },
    { assetId: "modern-port", altText: "" },
    { assetId: "", altText: "Ships at a port" },
    { assetId: 42, altText: "Ships at a port" },
    { assetId: "modern-port", altText: 42 },
  ])("should reject an image without a non-empty asset identifier and alternative text: %j", (image) => {
    const issue = createNewspaperIssue();
    const input = { ...issue, items: [{ ...issue.items[0], image }] };
    expect(issueDocumentSchema.safeParse(input).success).toBe(false);
  });

  it("should require one evidence value per data column", () => {
    const issue = createNewspaperIssue();
    issue.items[0].evidenceTable = {
      title: "Trade observations",
      description: "Shares by turn",
      columns: ["Turn", "Share", "Change"],
      rows: [{ label: "Turn 12", values: ["54%", "16%"], hasMissingValues: false }],
      footnote: "Compared with the previous observation.",
    };
    expect(issueDocumentSchema.parse(issue).items[0].evidenceTable).toEqual(issue.items[0].evidenceTable);
    issue.items[0].evidenceTable.rows[0].values.pop();
    const result = issueDocumentSchema.safeParse(issue);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["items", 0, "evidenceTable", "rows", 0, "values"] }),
      ]));
    }
  });
});
