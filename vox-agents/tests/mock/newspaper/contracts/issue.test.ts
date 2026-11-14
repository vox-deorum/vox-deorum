/** Verify publication input structure without depending on presentation assets. */
import { describe, expect, it } from "vitest";
import { createNewspaperIssue } from "../../../helpers/newspaper-fixtures.js";
import { issueDocumentSchema } from "../../../../src/newspaper/contracts/issue.js";

describe("newspaper issue contracts", () => {
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
    issue.items[0].assetId = "editor-image-awaiting-registration";
    issue.publication.ornamentAssetId = "editor-ornament-awaiting-registration";
    const parsed = issueDocumentSchema.parse(issue);
    expect(parsed.items[0].assetId).toBe(issue.items[0].assetId);
    expect(parsed.publication.ornamentAssetId).toBe(issue.publication.ornamentAssetId);
  });
});
