/** Browser-safe newspaper asset registry and lookups. */
import type { NewspaperDesignId } from "../contracts/types.js";

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
}

/** Registered asset paths and their licenses. */
export const newspaperAssets = {
  "font-unifrakturmaguntia-400": {
    id: "font-unifrakturmaguntia-400",
    kind: "font",
    path: "assets/fonts/unifrakturmaguntia-normal-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/unifrakturmaguntia-OFL.txt",
    attribution: "UnifrakturMaguntia by j. 'mach' wust and Peter Wiegel.",
  },
  "font-bodoni-moda-400": {
    id: "font-bodoni-moda-400",
    kind: "font",
    path: "assets/fonts/bodoni-moda-normal-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/bodonimoda-OFL.txt",
    attribution: "Bodoni Moda by the Bodoni Moda Project Authors.",
  },
  "font-bodoni-moda-700": {
    id: "font-bodoni-moda-700",
    kind: "font",
    path: "assets/fonts/bodoni-moda-normal-700.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/bodonimoda-OFL.txt",
    attribution: "Bodoni Moda by the Bodoni Moda Project Authors.",
  },
  "font-bodoni-moda-900": {
    id: "font-bodoni-moda-900",
    kind: "font",
    path: "assets/fonts/bodoni-moda-normal-900.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/bodonimoda-OFL.txt",
    attribution: "Bodoni Moda by the Bodoni Moda Project Authors.",
  },
  "font-bodoni-moda-italic-400": {
    id: "font-bodoni-moda-italic-400",
    kind: "font",
    path: "assets/fonts/bodoni-moda-italic-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/bodonimoda-OFL.txt",
    attribution: "Bodoni Moda by the Bodoni Moda Project Authors.",
  },
  "font-libre-caslon-400": {
    id: "font-libre-caslon-400",
    kind: "font",
    path: "assets/fonts/libre-caslon-text-normal-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/librecaslontext-OFL.txt",
    attribution: "Libre Caslon Text by the Libre Caslon Text Project Authors.",
  },
  "font-libre-caslon-700": {
    id: "font-libre-caslon-700",
    kind: "font",
    path: "assets/fonts/libre-caslon-text-normal-700.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/librecaslontext-OFL.txt",
    attribution: "Libre Caslon Text by the Libre Caslon Text Project Authors.",
  },
  "font-libre-caslon-italic-400": {
    id: "font-libre-caslon-italic-400",
    kind: "font",
    path: "assets/fonts/libre-caslon-text-italic-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/librecaslontext-OFL.txt",
    attribution: "Libre Caslon Text by the Libre Caslon Text Project Authors.",
  },
  "font-inter-400": {
    id: "font-inter-400",
    kind: "font",
    path: "assets/fonts/inter-normal-400.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/inter-OFL.txt",
    attribution: "Inter by the Inter Project Authors.",
  },
  "font-inter-500": {
    id: "font-inter-500",
    kind: "font",
    path: "assets/fonts/inter-normal-500.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/inter-OFL.txt",
    attribution: "Inter by the Inter Project Authors.",
  },
  "font-inter-600": {
    id: "font-inter-600",
    kind: "font",
    path: "assets/fonts/inter-normal-600.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/inter-OFL.txt",
    attribution: "Inter by the Inter Project Authors.",
  },
  "font-inter-700": {
    id: "font-inter-700",
    kind: "font",
    path: "assets/fonts/inter-normal-700.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/inter-OFL.txt",
    attribution: "Inter by the Inter Project Authors.",
  },
  "font-inter-800": {
    id: "font-inter-800",
    kind: "font",
    path: "assets/fonts/inter-normal-800.ttf",
    mediaType: "font/ttf",
    license: "OFL-1.1",
    licensePath: "assets/licenses/inter-OFL.txt",
    attribution: "Inter by the Inter Project Authors.",
  },
  "victorian-harbour": {
    id: "victorian-harbour",
    kind: "image",
    path: "assets/images/victorian-harbour.png",
    mediaType: "image/png",
    width: 1536,
    height: 1024,
    license: "Generated for Vox Deorum",
    attribution: "Generated with the built-in image tool for the newspaper prototype.",
  },
  "modern-port": {
    id: "modern-port",
    kind: "image",
    path: "assets/images/modern-port.png",
    mediaType: "image/png",
    width: 1536,
    height: 1024,
    license: "Generated for Vox Deorum",
    attribution: "Generated with the built-in image tool for the newspaper prototype.",
  },
  "victorian-ornament": {
    id: "victorian-ornament",
    kind: "ornament",
    path: "assets/ornaments/victorian.svg",
    mediaType: "image/svg+xml",
    width: 900,
    height: 70,
    license: "Vox Deorum project asset",
    attribution: "Authored SVG scrollwork for the Victorian prototype.",
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

/** Asset identifiers known to the renderer. */
export type NewspaperAssetId = keyof typeof newspaperAssets;

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
  NewspaperDesignId,
  Record<"up" | "down", { neutral: NewspaperAssetId; selected: NewspaperAssetId }>
>;

/** Return a registered asset, or undefined for an unknown id. */
export function getNewspaperAsset(id: string): NewspaperAsset | undefined {
  return isNewspaperAssetId(id) ? newspaperAssets[id] : undefined;
}

/** Tell whether a string names a registered asset. */
export function isNewspaperAssetId(id: string): id is NewspaperAssetId {
  return Object.prototype.hasOwnProperty.call(newspaperAssets, id);
}

