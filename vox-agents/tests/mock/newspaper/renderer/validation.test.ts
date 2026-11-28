/** Verify presentation readiness before an issue reaches the renderer. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createNewspaperIssue } from "../../../helpers/newspaper-fixtures.js";
import { issueDocumentSchema } from "../../../../src/newspaper/contracts/issue.js";
import { parseIssueDocument } from "../../../../src/newspaper/renderer/validation.js";

describe("newspaper renderer issue validation", () => {
  it("should render configurable identities through the stored family and asset snapshot", () => {
    const issue = createNewspaperIssue();
    issue.publication.designId = "early-account";
    issue.publication.presentation = {
      schemaVersion: 1, rendererFamily: "feed",
      tokens: { headingFontAssetId: "font-bodoni-moda-700", bodyFontAssetId: "font-inter-400" },
    };
    const saved = parseIssueDocument(issue);
    expect(saved.publication.presentation.rendererFamily).toBe("feed");
    expect(saved.publication.presentation.assets?.ornamentAssetId).toBeUndefined();
    expect(saved.publication.presentation).toEqual(issue.publication.presentation);
  });

  it.each(["bodyFontAssetId", "headingFontAssetId", "mastheadFontAssetId"] as const)("should reject a non-font presentation reference for %s", (role) => {
    const issue = createNewspaperIssue();
    issue.publication.presentation = { schemaVersion: 1, rendererFamily: "feed", tokens: { bodyFontAssetId: "font-inter-400", [role]: "endless-scroll.port" } };
    expect(() => parseIssueDocument(issue)).toThrowError(expect.objectContaining({
      issues: expect.arrayContaining([expect.objectContaining({ path: ["publication", "presentation", "tokens", role] })]),
    }));
  });

  it("should accept registered snapshot ornaments", () => {
    const issue = createNewspaperIssue();
    issue.publication.presentation = { schemaVersion: 1, rendererFamily: "broadsheet", assets: { ornamentAssetId: "steam-press-broadsheet.scrollwork" } };
    expect(parseIssueDocument(issue).publication.presentation.assets?.ornamentAssetId).toBe("steam-press-broadsheet.scrollwork");
  });

  it.each(["unregistered-image", "steam-press-broadsheet.scrollwork", "font-inter-400"])(
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

  it.each(["unregistered-ornament", "endless-scroll.port", "vote-feed-up-neutral"])(
    "should reject an unknown or non-ornament publication asset: %s", (assetId) => {
      const issue = createNewspaperIssue();
      issue.publication.presentation.assets = { ornamentAssetId: assetId };
      expect(issueDocumentSchema.parse(issue).publication.presentation.assets?.ornamentAssetId).toBe(assetId);
      expect(() => parseIssueDocument(issue)).toThrow();
    },
  );

  it("should accept a registered article image with alternative text", () => {
    const issue = createNewspaperIssue();
    issue.items[0].image = { assetId: "endless-scroll.port", altText: "Ships at a port" };
    expect(parseIssueDocument(issue).items[0].image).toEqual(issue.items[0].image);
  });

  it.each(["steam-press-broadsheet-ordinary", "steam-press-broadsheet-breaking", "steam-press-broadsheet-analysis", "endless-scroll-ordinary"])(
    "should accept the complete renderer fixture: %s", async (fixture) => {
      const input = JSON.parse(await readFile(new URL(`../../../../newspaper/fixtures/${fixture}.json`, import.meta.url), "utf8"));
      const issue = parseIssueDocument(input);
      expect(issue).toEqual(input);
    },
  );
});
