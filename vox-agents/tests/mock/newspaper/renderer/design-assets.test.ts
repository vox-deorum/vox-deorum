/** Verify discovery and validation of assets declared by built-in designs. */
import { describe, expect, it } from "vitest";
import { getNewspaperAsset } from "../../../../src/newspaper/renderer/assets.js";
import { normalizeDesignAssets } from "../../../../src/newspaper/renderer/design-assets.js";

/** Build one authored definition with optional field changes. */
function assetDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: "seal",
    kind: "image",
    path: "assets/images/seal.png",
    mediaType: "image/png",
    width: 64,
    height: 64,
    license: "Test license",
    attribution: "Test attribution",
    ...overrides,
  };
}

/** Build one design document with the supplied definitions. */
function designDocument(id: string, assetDefinitions: unknown[]): unknown {
  return [{ id, assetDefinitions }];
}

describe("newspaper design assets", () => {
  it("should resolve assets migrated onto the built-in designs", () => {
    expect(getNewspaperAsset("victorian.scrollwork")).toMatchObject({
      kind: "ornament",
      path: "assets/ornaments/victorian.svg",
    });
    expect(getNewspaperAsset("victorian.harbour")).toMatchObject({
      kind: "image",
      path: "assets/images/victorian-harbour.png",
    });
    expect(getNewspaperAsset("modern.port")).toMatchObject({
      kind: "image",
      path: "assets/images/modern-port.png",
    });
  });

  it("should let two designs use the same local asset id", () => {
    const assets = normalizeDesignAssets([
      designDocument("tablet", [assetDefinition()]),
      designDocument("gazette", [assetDefinition({ path: "assets/images/gazette-seal.png" })]),
    ]);
    expect(assets.get("tablet.seal")?.path).toBe("assets/images/seal.png");
    expect(assets.get("gazette.seal")?.path).toBe("assets/images/gazette-seal.png");
  });

  it.each([
    "images/seal.png",
    "assets/../seal.png",
    "assets/%2e%2e/seal.png",
    "assets//seal.png",
    "assets/seal.png?cache=1",
    "assets/seal.png#fragment",
    "https://example.com/seal.png",
    "/assets/seal.png",
    "assets\\seal.png",
  ])("should reject an unsafe or non-local asset path: %s", (path) => {
    expect(() => normalizeDesignAssets([designDocument("probe", [assetDefinition({ path })])])).toThrow();
  });

  it.each([
    { kind: "font" },
    { id: "bad.id" },
    { width: 0 },
    { height: 1.5 },
    { mediaType: "" },
    { mediaType: "text/html" },
    { license: "" },
    { attribution: 42 },
  ])("should reject malformed definition metadata: %j", (change) => {
    expect(() => normalizeDesignAssets([designDocument("probe", [assetDefinition(change)])])).toThrow();
  });

  it("should reject a malformed definition list", () => {
    expect(() => normalizeDesignAssets([[{ id: "probe", assetDefinitions: {} }]])).toThrow();
    expect(() => normalizeDesignAssets([designDocument("probe", [null])])).toThrow();
  });

  it("should reject two declarations that derive the same id", () => {
    expect(() => normalizeDesignAssets([
      designDocument("probe", [assetDefinition(), assetDefinition()]),
    ])).toThrow();
  });

  it("should reject duplicate ids across design documents", () => {
    const document = designDocument("probe", [assetDefinition()]);
    expect(() => normalizeDesignAssets([document, document])).toThrow();
  });
});
