/** Resolve the texture files shared by disk caches and Lua fixtures. */
import path from "node:path";
import type { RenderBundle } from "../renderer/types.js";

/** Enumerate generated textures and the dimensions required by their consumers. */
export function bundleTextures(bundle: RenderBundle): Map<string, { width: number; height: number }> {
  const textures = new Map<string, { width: number; height: number }>();
  for (const region of [bundle.header, ...bundle.pages]) {
    for (const strip of region.strips) textures.set(strip.fileName, { width: strip.pixelWidth, height: strip.pixelHeight });
  }
  for (const page of bundle.pages) {
    for (const slot of page.voteSlots) {
      for (const id of [slot.neutralAssetId, slot.selectedAssetId]) {
        textures.set(`${id}.dds`, { width: Math.round(24 * bundle.profile.rasterScale), height: Math.round(24 * bundle.profile.rasterScale) });
      }
    }
  }
  return textures;
}

/** Resolve an asset basename while rejecting traversal and platform-specific path syntax. */
export function resolveBundleAsset(directory: string, fileName: string): string {
  if (!/^[a-zA-Z0-9_-]+\.dds$/.test(fileName)) throw new Error('Invalid newspaper texture asset ID.');
  return path.join(directory, fileName);
}

