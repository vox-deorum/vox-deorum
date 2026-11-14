/** Atomic, bounded disk cache for disposable newspaper textures. */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IssueDocument, RenderBundle, RenderProfile } from '../contracts/types.js';
import { newspaperRendererVersion, newspaperRenderBundleSchemaVersion } from '../contracts/types.js';
import { bundleTextures, resolveBundleAsset } from './bundle-assets.js';
import { validateRenderBundle } from '../contracts/bundle.js';
import { validateDds, type DdsFormat } from '../renderer/dds.js';

export interface CachedBundle { key: string; directory: string; bundle: RenderBundle }
export type CacheIdentity = Pick<RenderBundle, 'issueId' | 'campaignId' | 'timelineId' | 'designId' | 'designVersion' | 'profile'>;

/** Match the manifest to the publication and capture settings requested by its caller. */
function matchesIdentity(bundle: RenderBundle, expected?: CacheIdentity): boolean {
  return !expected || Object.entries(expected).every(([name, value]) =>
    name === 'profile'
      ? Object.entries(value as RenderProfile).every(([field, setting]) => bundle.profile[field as keyof RenderProfile] === setting)
      : bundle[name as keyof CacheIdentity] === value);
}

/** Hash actual compiled design assets and code so changed files invalidate old exports. */
export async function hashReaderAssets(directory: string): Promise<string> {
  const hash = createHash('sha256');
  /** Visit files in deterministic order, excluding the developer fixture host's data. */
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'fixtures') continue;
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) hash.update(name.replaceAll('\\', '/')).update(await readFile(path.join(directory, name)));
    }
  }
  await visit('');
  return hash.digest('hex');
}

/** Key immutable publication content, design/code bytes, schema, and capture settings. */
export function renderCacheKey(issue: IssueDocument, profile: RenderProfile, assetsHash: string, format: DdsFormat): string {
  return createHash('sha256').update(JSON.stringify({
    issue, profile, assetsHash, format,
    renderer: newspaperRendererVersion, schema: newspaperRenderBundleSchemaVersion,
  })).digest('hex');
}

/** Check every texture before publication or cache reuse, including exact DDS payload sizes. */
async function verifyTextures(directory: string, bundle: RenderBundle): Promise<void> {
  for (const [name, size] of bundleTextures(bundle)) {
    validateDds(await readFile(resolveBundleAsset(directory, name)), size.width, size.height);
  }
}

/** Publish only complete bundles and retain the fixture viewer's most recent export. */
export class NewspaperCache {
  private pending: Promise<unknown> = Promise.resolve();

  /** Keep the root explicit so tests and installed readers can use different cache locations. */
  constructor(readonly root: string, readonly maxBytes = 256 * 1024 * 1024) {}

  /** Serialize cache mutations and reuse validated bundles without starting a browser. */
  getOrCreate(key: string, render: (directory: string) => Promise<RenderBundle>, expected?: CacheIdentity): Promise<CachedBundle> {
    const result = this.pending.then(() => this.publish(key, render, expected));
    this.pending = result.catch(() => undefined);
    return result;
  }

  /** Read an immutable bundle, treating missing, incompatible, or incomplete data as a miss. */
  async read(key: string, expected?: CacheIdentity): Promise<CachedBundle | undefined> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid newspaper cache key.');
    const directory = path.join(this.root, key);
    try {
      const bundle = validateRenderBundle(JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')));
      if (!matchesIdentity(bundle, expected)) return undefined;
      await verifyTextures(directory, bundle);
      const now = new Date();
      await utimes(path.join(directory, 'manifest.json'), now, now);
      return { key, directory, bundle };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EACCES') throw error;
      return undefined;
    }
  }

  /** Protect the delivered fixture across process restarts before running cache eviction. */
  pin(key: string): Promise<void> {
    const result = this.pending.then(() => this.writePin(key));
    this.pending = result.catch(() => undefined);
    return result;
  }

  /** Commit the viewer pin within the same queue as publication and eviction. */
  private async writePin(key: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid newspaper cache key.');
    await mkdir(this.root, { recursive: true });
    await writeFile(path.join(this.root, 'viewer.tmp'), key, 'utf8');
    await rename(path.join(this.root, 'viewer.tmp'), path.join(this.root, 'viewer.txt'));
    await this.evict(key);
  }

  /** Stage all output beside its final directory, then publish it with one rename. */
  private async publish(key: string, render: (directory: string) => Promise<RenderBundle>, expected?: CacheIdentity): Promise<CachedBundle> {
    const cached = await this.read(key, expected);
    if (cached) return cached;
    await mkdir(this.root, { recursive: true });
    const temporary = await mkdtemp(path.join(this.root, '.pending-'));
    const directory = path.join(this.root, key);
    try {
      const bundle = validateRenderBundle(await render(temporary));
      if (!matchesIdentity(bundle, expected)) throw new Error('Newspaper render does not match the requested issue or profile.');
      await verifyTextures(temporary, bundle);
      await writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(bundle), 'utf8');
      // Replace only an invalid entry for this exact content key.
      await rm(directory, { recursive: true, force: true });
      await rename(temporary, directory);
      await this.evict(key);
      return { key, directory, bundle };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  /** Evict least recently read bundles, preserving the current request and the fixture pin. */
  private async evict(current: string): Promise<void> {
    const pinned = await readFile(path.join(this.root, 'viewer.txt'), 'utf8').catch(() => '');
    const bundles: { directory: string; key: string; bytes: number; used: number }[] = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const directory = path.join(this.root, entry.name);
      let bytes = 0;
      for (const file of await readdir(directory)) bytes += (await stat(path.join(directory, file))).size;
      const used = (await stat(path.join(directory, 'manifest.json')).catch(() => ({ mtimeMs: 0 }))).mtimeMs;
      bundles.push({ directory, key: entry.name, bytes, used });
    }
    let total = bundles.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of bundles.sort((a, b) => a.used - b.used)) {
      if (total <= this.maxBytes) break;
      if (entry.key === current || entry.key === pinned) continue;
      await rm(entry.directory, { recursive: true, force: true });
      total -= entry.bytes;
    }
  }
}
