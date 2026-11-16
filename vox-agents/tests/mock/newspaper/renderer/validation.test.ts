/** Verify presentation readiness before an issue reaches the renderer. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createNewspaperIssue } from "../../../helpers/newspaper-fixtures.js";
import { issueDocumentSchema } from "../../../../src/newspaper/contracts/issue.js";
import { parseIssueDocument } from "../../../../src/newspaper/renderer/validation.js";
import { getPublicationRendererFamily, getPublicationOrnament } from "../../../../src/newspaper/renderer/presentation.js";

describe("newspaper renderer issue validation", () => {
  it("should render configurable identities through the stored family and asset snapshot", () => {
    const issue = createNewspaperIssue();
    issue.schemaVersion = 2;
    issue.publication.designId = "early-account";
    issue.publication.ornamentAssetId = "victorian-ornament";
    issue.publication.presentation = {
      schemaVersion: 1, rendererFamily: "modern",
      tokens: { headingFontAssetId: "font-bodoni-moda-700", bodyFontAssetId: "font-inter-400" },
    };
    const saved = parseIssueDocument(issue);
    expect(getPublicationRendererFamily(saved.publication)).toBe("modern");
    expect(getPublicationOrnament(saved.publication)).toBeUndefined();
    expect(saved.publication.presentation).toEqual(issue.publication.presentation);
    expect(getPublicationRendererFamily(createNewspaperIssue().publication)).toBe("modern");
  });

  it.each(["bodyFontAssetId", "headingFontAssetId", "mastheadFontAssetId"] as const)("should reject a non-font presentation reference for %s", (role) => {
    const issue = createNewspaperIssue();
    issue.schemaVersion = 2;
    issue.publication.presentation = { schemaVersion: 1, rendererFamily: "modern", tokens: { bodyFontAssetId: "font-inter-400", [role]: "modern-port" } };
    expect(() => parseIssueDocument(issue)).toThrowError(expect.objectContaining({
      issues: expect.arrayContaining([expect.objectContaining({ path: ["publication", "presentation", "tokens", role] })]),
    }));
  });

  it("should validate snapshot ornaments independently of legacy fixture ornament fields", () => {
    const issue = createNewspaperIssue();
    issue.schemaVersion = 2;
    issue.publication.presentation = { schemaVersion: 1, rendererFamily: "victorian", assets: { ornamentAssetId: "modern-port" } };
    expect(() => parseIssueDocument(issue)).toThrow();
    issue.publication.presentation.assets!.ornamentAssetId = "victorian-ornament";
    expect(getPublicationOrnament(parseIssueDocument(issue).publication)).toBe("victorian-ornament");
  });

  it.each(["unregistered-image", "victorian-ornament", "font-inter-400"])(
    "should reject an unknown or non-image article asset: %s", (assetId) => {
      const issue = createNewspaperIssue();
      issue.items[0].image = { assetId, altText: "A report illustration" };
      expect(issueDocumentSchema.parse(issue).items[0].image?.assetId).toBe(assetId);
      expect(() => parseIssueDocument(issue)).toThrowError(expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["items", 0, "image", "assetId"] }),
        ]),
      }));
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

  it("should accept a registered article image with alternative text", () => {
    const issue = createNewspaperIssue();
    issue.items[0].image = { assetId: "modern-port", altText: "Ships at a port" };
    expect(parseIssueDocument(issue).items[0].image).toEqual(issue.items[0].image);
  });

  it.each(["victorian-ordinary", "victorian-breaking", "victorian-analysis", "modern-ordinary"])(
    "should accept the complete renderer fixture: %s", async (fixture) => {
      const input = JSON.parse(await readFile(new URL(`../../../../newspaper/fixtures/${fixture}.json`, import.meta.url), "utf8"));
      const issue = parseIssueDocument(input);
      expect(issue).toEqual(input);
    },
  );
});
