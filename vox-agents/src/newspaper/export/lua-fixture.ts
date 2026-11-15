/** Build plain structured data for the in-game newspaper reader. */
import path from 'node:path';
import type { CachedBundle } from './cache.js';
import { bundleTextures, resolveBundleAsset } from './bundle-assets.js';
import { createReaderState } from '../renderer/state.js';
import type { IssueDocument } from '../contracts/issue.js';

/** Build structured reader data with resolved texture paths for fixtures or game delivery. */
export function buildLuaFixturePayload(issue: IssueDocument, cached: CachedBundle, cacheRoot: string) {
  const assets: Record<string, string> = {};
  for (const fileName of bundleTextures(cached.bundle).keys()) {
    const absolute = resolveBundleAsset(cached.directory, fileName).replaceAll('\\', '/');
    assets[fileName] = absolute;
    if (fileName.startsWith('vote-')) assets[fileName.slice(0, -4)] = absolute;
  }
  return { issue, bundle: cached.bundle, assets, state: createReaderState(issue), cacheRoot: path.resolve(cacheRoot).replaceAll('\\', '/') };
}

