/** Deliver a stage-scoped fixture without requiring runtime JSON or file I/O in UI Lua. */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CachedBundle } from './cache.js';
import { bundleTextures, resolveBundleAsset } from './bundle-assets.js';
import { createReaderState } from '../renderer/state.js';
import type { IssueDocument } from '../contracts/issue.js';

/** Quote UTF-8 text using Lua 5.1 escapes, including control characters and backslashes. */
function luaString(value: string): string {
  // Lua quoted strings must escape literal control bytes in generated article text.
  // eslint-disable-next-line no-control-regex
  return `"${value.replace(/[\\"\x00-\x1f\x7f]/g, character => `\\${character.charCodeAt(0).toString().padStart(3, '0')}`)}"`;
}

/** Serialize plain validated data as Lua literals with no executable source from article text. */
export function luaLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'string') return luaString(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `{${value.map(luaLiteral).join(',')}}`;
  if (typeof value === 'object') {
    return `{${Object.entries(value).map(([key, entry]) => `[${luaString(key)}]=${luaLiteral(entry)}`).join(',')}}`;
  }
  throw new Error('Unsupported value in newspaper fixture.');
}

/** Write resolved local paths and structured text only into the generated development fixture. */
export async function writeLuaFixture(destination: string, issue: IssueDocument, cached: CachedBundle, cacheRoot: string): Promise<void> {
  const assets: Record<string, string> = {};
  for (const fileName of bundleTextures(cached.bundle).keys()) {
    const absolute = resolveBundleAsset(cached.directory, fileName).replaceAll('\\', '/');
    assets[fileName] = absolute;
    if (fileName.startsWith('vote-')) assets[fileName.slice(0, -4)] = absolute;
  }
  const data = { issue, bundle: cached.bundle, assets, state: createReaderState(issue), cacheRoot: path.resolve(cacheRoot).replaceAll('\\', '/') };
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(`${destination}.tmp`, `-- Generated newspaper proof fixture. Excluded from production packaging.\nVoxDeorumNewspaperFixture = ${luaLiteral(data)}\n`, 'utf8');
  await rename(`${destination}.tmp`, destination);
}
