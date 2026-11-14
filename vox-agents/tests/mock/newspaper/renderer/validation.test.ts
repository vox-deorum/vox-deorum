/** Verify presentation readiness before an issue reaches the renderer. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createNewspaperIssue } from "../../../helpers/newspaper-fixtures.js";
import { issueDocumentSchema } from "../../../../src/newspaper/contracts/issue.js";
import { parseIssueDocument } from "../../../../src/newspaper/renderer/validation.js";

describe("newspaper renderer issue validation", () => {
  it.each(["unregistered-image", "victorian-ornament", "font-inter-400"])(
    "should reject an unknown or non-image article asset: %s", (assetId) => {
      const issue = createNewspaperIssue();
      issue.items[0].assetId = assetId;
      issue.items[0].assetAlt = "A report illustration";
      expect(issueDocumentSchema.parse(issue).items[0].assetId).toBe(assetId);
      expect(() => parseIssueDocument(issue)).toThrow();
    },
  );

  it.each(["unregistered-ornament", "modern-port", "vote-modern-up-neutral"])(
    "should reject an unknown or non-ornament publication asset: %s", (assetId) => {
      const issue = createNewspaperIssue();
      issue.publication.ornamentAssetId = assetId;
      expect(issueDocumentSchema.parse(issue).publication.ornamentAssetId).toBe(assetId);
      expect(() => parseIssueDocument(issue)).toThrow();
    },
  );

  it("should require alternative text for registered article images", () => {
    const issue = createNewspaperIssue();
    issue.items[0].assetId = "modern-port";
    expect(issueDocumentSchema.parse(issue).items[0].assetId).toBe("modern-port");
    expect(() => parseIssueDocument(issue)).toThrow();
    issue.items[0].assetAlt = "Ships at a port";
    expect(parseIssueDocument(issue).items[0].assetAlt).toBe(issue.items[0].assetAlt);
  });

  it.each(["victorian-ordinary", "victorian-breaking", "victorian-analysis", "modern-ordinary"])(
    "should accept the complete renderer fixture: %s", async (fixture) => {
      const input = JSON.parse(await readFile(new URL(`../../../../newspaper/fixtures/${fixture}.json`, import.meta.url), "utf8"));
      const issue = parseIssueDocument(input);
      expect(issue).toEqual(input);
    },
  );
});
