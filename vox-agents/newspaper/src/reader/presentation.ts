/** Apply the immutable colors and registered font assets saved with a publication. */
import type { IssuePublication } from "../../../src/newspaper/contracts/issue.js";
import { getNewspaperAsset, getNewspaperFontFaces } from "../../../src/newspaper/renderer/assets.js";
import { resolveAssetUrl } from "./dom.js";

/** Apply a saved presentation and return its media readiness and cleanup. */
export function applyPublicationPresentation(root: HTMLElement, publication: IssuePublication, assetBaseUrl: string, instancePrefix: string): { ready: Promise<void>; dispose(): void } {
  const tokens = publication.presentation?.tokens;
  const properties: string[] = [];
  const fonts: FontFace[] = [];
  /** Save each applied property for removal when the reader is disposed. */
  function setProperty(name: string, value: string | undefined): void {
    if (!value) return;
    root.style.setProperty(name, value);
    properties.push(name);
  }
  setProperty("--vd-paper", tokens?.paperColor);
  setProperty("--vd-ink", tokens?.inkColor);
  setProperty("--vd-accent", tokens?.accentColor);
  for (const [role, assetId] of [["body", tokens?.bodyFontAssetId], ["display", tokens?.headingFontAssetId], ["masthead", tokens?.mastheadFontAssetId]] as const) {
    if (!assetId) continue;
    const metadata = getNewspaperAsset(assetId)?.font;
    if (!metadata) continue;
    const family = `${instancePrefix}-${role}`;
    for (const asset of getNewspaperFontFaces(assetId)) {
      const url = resolveAssetUrl(assetBaseUrl, asset.id);
      if (!url || !asset.font) continue;
      const font = new FontFace(family, `url(${JSON.stringify(url)})`, { weight: String(asset.font.weight), style: asset.font.style });
      document.fonts.add(font);
      fonts.push(font);
    }
    setProperty(`--vd-font-${role}`, `"${family}", ${metadata.fallback}`);
  }
  return {
    ready: Promise.allSettled(fonts.map((font) => font.load())).then(() => undefined),
    /** Remove instance fonts and properties when the host disposes this reader. */
    dispose(): void {
      for (const font of fonts) document.fonts.delete(font);
      for (const property of properties) root.style.removeProperty(property);
    },
  };
}
