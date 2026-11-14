/** Shared layout defaults and measurements for the reader and exporter. */
import type { NewspaperDesignId } from "../contracts/issue.js";
import type { RenderProfile, RenderLayoutMetrics } from "./types.js";

/** Layout defaults for one visual design. */
export interface NewspaperDesignLayoutDefaults {
  contentWidth: number;
  paperPadding: number;
  scrollbarGutter: number;
}

/** Default browser reading viewport used by the fixture host. */
export const defaultReaderViewport = { width: 1440, height: 900 } as const;

/** Default raster scale used before a RenderProfile is supplied. */
export const defaultRasterScale = 1;

/** Default text scale used before a RenderProfile is supplied. */
export const defaultTextScale = 1;

/** Default maximum texture edge used by the first export proof. */
export const defaultMaxTextureEdge = 2048;

/** Design-specific layout defaults used by the browser reader and exporter. */
export const newspaperDesignDefaults = {
  victorian: {
    contentWidth: 900,
    paperPadding: 48,
    scrollbarGutter: 16,
  },
  modern: {
    contentWidth: 900,
    paperPadding: 32,
    scrollbarGutter: 16,
  },
} as const satisfies Record<NewspaperDesignId, NewspaperDesignLayoutDefaults>;

/** Default browser capture profile for a newspaper export. */
export const defaultRenderProfile: RenderProfile = {
  viewportWidth: 1280, viewportHeight: 720, contentWidth: 900, textScale: 1,
  rasterScale: 1, maxTextureWidth: 2048, maxTextureHeight: 2048, scrollbarGutter: 16,
};

/** Compute the fixed outer width of a publication region. */
export function computeRegionWidth(
  designId: NewspaperDesignId,
  contentWidth: number,
  scrollbarGutter: number,
): number {
  const defaults = newspaperDesignDefaults[designId];
  return contentWidth + defaults.paperPadding * 2 + scrollbarGutter;
}

/** Turn a render profile and design into the metrics used by CSS and export. */
export function computeRenderLayout(
  designId: NewspaperDesignId,
  profile: RenderProfile,
): RenderLayoutMetrics {
  const defaults = newspaperDesignDefaults[designId];
  return {
    contentWidth: profile.contentWidth,
    paperPadding: defaults.paperPadding,
    scrollbarGutter: profile.scrollbarGutter,
    regionWidth: computeRegionWidth(designId, profile.contentWidth, profile.scrollbarGutter),
    viewportWidth: profile.viewportWidth,
    viewportHeight: profile.viewportHeight,
    rasterScale: profile.rasterScale,
    textScale: profile.textScale,
  };
}
