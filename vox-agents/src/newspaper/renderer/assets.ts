/**
 * Newspaper asset registry and lookups.
 *
 * The reader build swaps the design document reader for bundled JSON, so the compiled reader stays browser-safe.
 */
import type { RendererFamily } from "../contracts/design.js";
import { readBuiltInDesignDocuments } from "../design-assets-source.js";
import { normalizeDesignAssets } from "./design-assets.js";

/** Kinds of asset that a registered newspaper asset can represent. */
export type NewspaperAssetKind = "font" | "image" | "ornament" | "vote-icon";

/** A single asset available to the shared renderer and the exporter. */
export interface NewspaperAsset {
  id: string;
  kind: NewspaperAssetKind;
  path: string;
  mediaType: string;
  width?: number;
  height?: number;
  license: string;
  licensePath?: string;
  attribution: string;
  font?: { family: string; weight: number; style: "normal" | "italic"; fallback: string };
}

/** Assets shared by every design, including fonts and vote icons. */
const sharedNewspaperAssets = {
  "font-unifrakturmaguntia-400": {
    id: "font-unifrakturmaguntia-400",
    kind: "font",
    font: { family: "UnifrakturMaguntia", weight: 400, style: "normal", fallback: '"Bodoni Moda", Georgia, serif' },
    path: "assets/fonts/unifrakturmaguntia-normal-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/unifrakturmaguntia-OFL.txt",
    attribution: "UnifrakturMaguntia by j. 'mach' wust and Peter Wiegel.",
  },
  "font-bodoni-moda-400": {
    id: "font-bodoni-moda-400",
    kind: "font",
    font: { family: "Bodoni Moda", weight: 400, style: "normal", fallback: "Georgia, serif" },
    path: "assets/fonts/bodoni-moda-normal-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/bodonimoda-OFL.txt",
    attribution: "Bodoni Moda by the Bodoni Moda Project Authors.",
  },
  "font-bodoni-moda-700": {
    id: "font-bodoni-moda-700",
    kind: "font",
    font: { family: "Bodoni Moda", weight: 700, style: "normal", fallback: "Georgia, serif" },
    path: "assets/fonts/bodoni-moda-normal-700.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/bodonimoda-OFL.txt",
    attribution: "Bodoni Moda by the Bodoni Moda Project Authors.",
  },
  "font-bodoni-moda-900": {
    id: "font-bodoni-moda-900",
    kind: "font",
    font: { family: "Bodoni Moda", weight: 900, style: "normal", fallback: "Georgia, serif" },
    path: "assets/fonts/bodoni-moda-normal-900.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/bodonimoda-OFL.txt",
    attribution: "Bodoni Moda by the Bodoni Moda Project Authors.",
  },
  "font-bodoni-moda-italic-400": {
    id: "font-bodoni-moda-italic-400",
    kind: "font",
    font: { family: "Bodoni Moda", weight: 400, style: "italic", fallback: "Georgia, serif" },
    path: "assets/fonts/bodoni-moda-italic-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/bodonimoda-OFL.txt",
    attribution: "Bodoni Moda by the Bodoni Moda Project Authors.",
  },
  "font-libre-caslon-400": {
    id: "font-libre-caslon-400",
    kind: "font",
    font: { family: "Libre Caslon Text", weight: 400, style: "normal", fallback: "Georgia, serif" },
    path: "assets/fonts/libre-caslon-text-normal-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/librecaslontext-OFL.txt",
    attribution: "Libre Caslon Text by the Libre Caslon Text Project Authors.",
  },
  "font-libre-caslon-700": {
    id: "font-libre-caslon-700",
    kind: "font",
    font: { family: "Libre Caslon Text", weight: 700, style: "normal", fallback: "Georgia, serif" },
    path: "assets/fonts/libre-caslon-text-normal-700.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/librecaslontext-OFL.txt",
    attribution: "Libre Caslon Text by the Libre Caslon Text Project Authors.",
  },
  "font-libre-caslon-italic-400": {
    id: "font-libre-caslon-italic-400",
    kind: "font",
    font: { family: "Libre Caslon Text", weight: 400, style: "italic", fallback: "Georgia, serif" },
    path: "assets/fonts/libre-caslon-text-italic-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/librecaslontext-OFL.txt",
    attribution: "Libre Caslon Text by the Libre Caslon Text Project Authors.",
  },
  "font-inter-400": {
    id: "font-inter-400",
    kind: "font",
    font: { family: "Inter", weight: 400, style: "normal", fallback: "Arial, sans-serif" },
    path: "assets/fonts/inter-normal-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/inter-OFL.txt",
    attribution: "Inter by the Inter Project Authors.",
  },
  "font-inter-500": {
    id: "font-inter-500",
    kind: "font",
    font: { family: "Inter", weight: 500, style: "normal", fallback: "Arial, sans-serif" },
    path: "assets/fonts/inter-normal-500.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/inter-OFL.txt",
    attribution: "Inter by the Inter Project Authors.",
  },
  "font-inter-600": {
    id: "font-inter-600",
    kind: "font",
    font: { family: "Inter", weight: 600, style: "normal", fallback: "Arial, sans-serif" },
    path: "assets/fonts/inter-normal-600.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/inter-OFL.txt",
    attribution: "Inter by the Inter Project Authors.",
  },
  "font-inter-700": {
    id: "font-inter-700",
    kind: "font",
    font: { family: "Inter", weight: 700, style: "normal", fallback: "Arial, sans-serif" },
    path: "assets/fonts/inter-normal-700.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/inter-OFL.txt",
    attribution: "Inter by the Inter Project Authors.",
  },
  "font-inter-800": {
    id: "font-inter-800",
    kind: "font",
    font: { family: "Inter", weight: 800, style: "normal", fallback: "Arial, sans-serif" },
    path: "assets/fonts/inter-normal-800.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/inter-OFL.txt",
    attribution: "Inter by the Inter Project Authors.",
  },
  "vote-victorian-up-neutral": {
    id: "vote-victorian-up-neutral",
    kind: "vote-icon",
    path: "assets/icons/vote-victorian-up-neutral.svg",
    mediaType: "image/svg+xml",
    width: 24,
    height: 24,
    license: "Vox Deorum project asset",
    attribution: "Authored vote icon for the Victorian design.",
  },
  "vote-victorian-up-selected": {
    id: "vote-victorian-up-selected",
    kind: "vote-icon",
    path: "assets/icons/vote-victorian-up-selected.svg",
    mediaType: "image/svg+xml",
    width: 24,
    height: 24,
    license: "Vox Deorum project asset",
    attribution: "Authored vote icon for the Victorian design.",
  },
  "vote-victorian-down-neutral": {
    id: "vote-victorian-down-neutral",
    kind: "vote-icon",
    path: "assets/icons/vote-victorian-down-neutral.svg",
    mediaType: "image/svg+xml",
    width: 24,
    height: 24,
    license: "Vox Deorum project asset",
    attribution: "Authored vote icon for the Victorian design.",
  },
  "vote-victorian-down-selected": {
    id: "vote-victorian-down-selected",
    kind: "vote-icon",
    path: "assets/icons/vote-victorian-down-selected.svg",
    mediaType: "image/svg+xml",
    width: 24,
    height: 24,
    license: "Vox Deorum project asset",
    attribution: "Authored vote icon for the Victorian design.",
  },
  "vote-modern-up-neutral": {
    id: "vote-modern-up-neutral",
    kind: "vote-icon",
    path: "assets/icons/vote-modern-up-neutral.svg",
    mediaType: "image/svg+xml",
    width: 24,
    height: 24,
    license: "Vox Deorum project asset",
    attribution: "Authored vote icon for the modern design.",
  },
  "vote-modern-up-selected": {
    id: "vote-modern-up-selected",
    kind: "vote-icon",
    path: "assets/icons/vote-modern-up-selected.svg",
    mediaType: "image/svg+xml",
    width: 24,
    height: 24,
    license: "Vox Deorum project asset",
    attribution: "Authored vote icon for the modern design.",
  },
  "vote-modern-down-neutral": {
    id: "vote-modern-down-neutral",
    kind: "vote-icon",
    path: "assets/icons/vote-modern-down-neutral.svg",
    mediaType: "image/svg+xml",
    width: 24,
    height: 24,
    license: "Vox Deorum project asset",
    attribution: "Authored vote icon for the modern design.",
  },
  "vote-modern-down-selected": {
    id: "vote-modern-down-selected",
    kind: "vote-icon",
    path: "assets/icons/vote-modern-down-selected.svg",
    mediaType: "image/svg+xml",
    width: 24,
    height: 24,
    license: "Vox Deorum project asset",
    attribution: "Authored vote icon for the modern design.",
  },
} as const satisfies Record<string, NewspaperAsset>;

/** Asset identifiers declared by the shared renderer. */
type SharedNewspaperAssetId = keyof typeof sharedNewspaperAssets;

let assetRegistry: ReadonlyMap<string, NewspaperAsset> | undefined;

/** Load authored definitions on first use so a bad design cannot break server startup. */
function getAssetRegistry(): ReadonlyMap<string, NewspaperAsset> {
  return assetRegistry ??= new Map([
    ...Object.entries(sharedNewspaperAssets),
    ...normalizeDesignAssets(readBuiltInDesignDocuments()),
  ]);
}

/** Vote icon asset pairs by design and direction. */
export const newspaperVoteIconAssets = {
  victorian: {
    up: {
      neutral: "vote-victorian-up-neutral",
      selected: "vote-victorian-up-selected",
    },
    down: {
      neutral: "vote-victorian-down-neutral",
      selected: "vote-victorian-down-selected",
    },
  },
  modern: {
    up: {
      neutral: "vote-modern-up-neutral",
      selected: "vote-modern-up-selected",
    },
    down: {
      neutral: "vote-modern-down-neutral",
      selected: "vote-modern-down-selected",
    },
  },
} as const satisfies Record<
  RendererFamily,
  Record<"up" | "down", { neutral: SharedNewspaperAssetId; selected: SharedNewspaperAssetId }>
>;

/** Return a registered asset, or undefined for an unknown id. */
export function getNewspaperAsset(id: string): NewspaperAsset | undefined {
  return getAssetRegistry().get(id);
}

/** Resolve every bundled weight and style belonging to the selected font's family. */
export function getNewspaperFontFaces(id: string): NewspaperAsset[] {
  const assets = getAssetRegistry();
  const family = assets.get(id)?.font?.family;
  return family ? [...assets.values()].filter(asset => asset.font?.family === family) : [];
}

