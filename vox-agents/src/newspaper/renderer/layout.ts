/** Shared layout defaults and measurements for the reader and exporter. */
import type { NewspaperDesignId } from "../contracts/issue.js";
import { newspaperViewSchema, type NewspaperView, type RenderProfile, type RenderLayoutMetrics } from "../contracts/render.js";

/** Layout defaults for one visual design. */
export interface NewspaperDesignLayoutDefaults {
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
    paperPadding: 48,
    scrollbarGutter: 16,
  },
  modern: {
    paperPadding: 32,
    scrollbarGutter: 16,
  },
} as const satisfies Record<NewspaperDesignId, NewspaperDesignLayoutDefaults>;

/** Default browser capture profile for a newspaper export. */
export const defaultRenderProfile: RenderProfile = {
  viewportWidth: 1280, viewportHeight: 720, paperWidth: 1200, displayScale: 1, textScale: 1,
  rasterScale: 2, maxTextureWidth: 4096, maxTextureHeight: 2048, scrollbarGutter: 16,
};

/** Fit a canonical CSS paper to the game's physical viewport at its requested zoom. */
export function computeRenderProfileForView(viewInput: NewspaperView): RenderProfile {
  const view = newspaperViewSchema.parse(viewInput);
  // Keep this width calculation aligned with VoxDeorumNewspaperData.PaperWidth in the Lua reader.
  const displayWidth = Math.min(view.width, defaultRenderProfile.paperWidth * view.zoom);
  const paperWidth = Math.floor(displayWidth / view.zoom * 64) / 64;
  return {
    ...defaultRenderProfile,
    paperWidth,
    displayScale: view.zoom,
    viewportWidth: Math.ceil(Math.ceil(paperWidth * defaultRenderProfile.rasterScale / 4) * 4 / defaultRenderProfile.rasterScale),
  };
}

/** Turn a render profile and design into the metrics used by CSS and export. */
export function computeRenderLayout(
  designId: NewspaperDesignId,
  profile: RenderProfile,
): RenderLayoutMetrics {
  const defaults = newspaperDesignDefaults[designId];
  const paperPadding = profile.paperWidth <= 480 ? 16 : profile.paperWidth <= 760 ? 24 : defaults.paperPadding;
  const contentWidth = profile.paperWidth - paperPadding * 2 - profile.scrollbarGutter;
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) {
    throw new Error("Publication width leaves no room for content after its margins and scrollbar gutter.");
  }
  return {
    contentWidth,
    paperPadding,
    scrollbarGutter: profile.scrollbarGutter,
    regionWidth: profile.paperWidth,
    viewportWidth: profile.viewportWidth,
    viewportHeight: profile.viewportHeight,
    rasterScale: profile.rasterScale,
    textScale: profile.textScale,
    displayScale: profile.displayScale,
  };
}
