/** Verify atomic bundle cache publication, invalidation, and bounded eviction. */
import { createNewspaperBundle } from "../../../helpers/newspaper-fixtures.js";
import { bundleTextures, resolveBundleAsset } from "../../../../src/newspaper/export/bundle-assets.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  NewspaperCache,
} from "../../../../src/newspaper/export/cache.js";
import {
  newspaperRenderBundleSchemaVersion,
  type RenderBundle,
} from "../../../../src/newspaper/renderer/types.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vd-newspaper-cache-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Create one minimal legacy BC1 texture with an exact payload. */
function createBc1Dds(width: number, height: number): Buffer {
  const payloadBytes = Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
  const buffer = Buffer.alloc(128 + payloadBytes);
  buffer.writeUInt32LE(0x20534444, 0);
  buffer.writeUInt32LE(124, 4);
  buffer.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, 8);
  buffer.writeUInt32LE(height, 12);
  buffer.writeUInt32LE(width, 16);
  buffer.writeUInt32LE(payloadBytes, 20);
  buffer.writeUInt32LE(0, 24);
  buffer.writeUInt32LE(1, 28);
  buffer.writeUInt32LE(32, 76);
  buffer.writeUInt32LE(0x4, 80);
  buffer.writeUInt32LE(0x31545844, 84);
  buffer.writeUInt32LE(0x1000, 108);
  buffer.writeUInt32LE(0, 112);
  return buffer;
}

/** Write every texture referenced by a bundle into a staging directory. */
async function writeTextures(directory: string, bundle: RenderBundle): Promise<void> {
  for (const [name, size] of bundleTextures(bundle)) {
    await writeFile(resolveBundleAsset(directory, name), createBc1Dds(size.width, size.height));
  }
}

/** Render a complete bundle into the staging directory supplied by the cache. */
async function renderBundle(directory: string): Promise<RenderBundle> {
  const bundle = createNewspaperBundle();
  await writeTextures(directory, bundle);
  return bundle;
}

/** Sum every file in one bundle directory. */
async function bundleBytes(key: string): Promise<number> {
  const directory = path.join(root, key);
  let bytes = 0;
  for (const file of await readdir(directory)) {
    bytes += (await stat(path.join(directory, file))).size;
  }
  return bytes;
}

/** Tell whether a path exists without throwing on a missing entry. */
async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("newspaper cache publication", () => {
  it("should replace a valid bundle whose identity differs from the requested issue", async () => {
    const cache = new NewspaperCache(root);
    const key = "9".repeat(64);
    await cache.getOrCreate(key, renderBundle);
    const { issueId, campaignId, timelineId, designId, designVersion, profile: requestedProfile } = createNewspaperBundle();
    const expected = { issueId: "issue-2", campaignId, timelineId, designId, designVersion, profile: requestedProfile };
    expect(issueId).not.toBe(expected.issueId);
    const render = vi.fn(async (directory: string) => {
      const bundle = { ...createNewspaperBundle(), issueId: expected.issueId };
      await writeTextures(directory, bundle);
      return bundle;
    });
    expect((await cache.getOrCreate(key, render, expected)).bundle.issueId).toBe(expected.issueId);
    expect(render).toHaveBeenCalledTimes(1);
    expect(await cache.read(key, { ...expected, profile: { ...requestedProfile, textScale: 2 } })).toBeUndefined();
    await expect(cache.getOrCreate("8".repeat(64), renderBundle, expected)).rejects.toThrow();
  });

  it("should finish publication before committing a concurrent fixture pin", async () => {
    const cache = new NewspaperCache(root);
    const key = "7".repeat(64);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const publication = cache.getOrCreate(key, async directory => {
      await blocked;
      return renderBundle(directory);
    });
    const pin = cache.pin(key);
    await new Promise(resolve => setImmediate(resolve));
    expect(await pathExists(path.join(root, "viewer.txt"))).toBe(false);
    release();
    await Promise.all([publication, pin]);
    expect(await readFile(path.join(root, "viewer.txt"), "utf8")).toBe(key);
  });

  it("should publish a complete bundle and reuse it without rendering again", async () => {
    const cache = new NewspaperCache(root);
    const key = "a".repeat(64);
    const render = vi.fn(renderBundle);

    const first = await cache.getOrCreate(key, render);
    expect(first.directory).toBe(path.join(root, key));
    expect(first.bundle.issueId).toBe("issue-1");
    const manifest = JSON.parse(await readFile(path.join(first.directory, "manifest.json"), "utf8"));
    expect(manifest.schemaVersion).toBe(newspaperRenderBundleSchemaVersion);
    expect(render).toHaveBeenCalledTimes(1);

    const second = await cache.getOrCreate(key, render);
    expect(second.directory).toBe(first.directory);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("should treat corrupt or incomplete cache entries as misses and replace them", async () => {
    const cache = new NewspaperCache(root);
    const render = vi.fn(renderBundle);

    const corruptKey = "b".repeat(64);
    await mkdir(path.join(root, corruptKey), { recursive: true });
    await writeFile(path.join(root, corruptKey, "manifest.json"), "{not json");
    const corrupt = await cache.getOrCreate(corruptKey, render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(await readFile(path.join(corrupt.directory, "manifest.json"), "utf8")).issueId,
    ).toBe("issue-1");

    const incompleteKey = "c".repeat(64);
    const incompleteDirectory = path.join(root, incompleteKey);
    await mkdir(incompleteDirectory, { recursive: true });
    await writeFile(
      path.join(incompleteDirectory, "manifest.json"),
      JSON.stringify(createNewspaperBundle()),
    );
    const incomplete = await cache.getOrCreate(incompleteKey, render);
    expect(render).toHaveBeenCalledTimes(2);
    expect(incomplete.directory).toBe(incompleteDirectory);
    expect(await pathExists(path.join(incompleteDirectory, "page-0.dds"))).toBe(true);
  });

  it("should remove staged output and leave no published entry after a failure", async () => {
    const cache = new NewspaperCache(root);
    const key = "d".repeat(64);

    await expect(
      cache.getOrCreate(key, async () => {
        throw new Error("render failed");
      }),
    ).rejects.toThrow("render failed");
    expect(await pathExists(path.join(root, key))).toBe(false);

    await expect(
      cache.getOrCreate(key, async (directory) => {
        const bundle = createNewspaperBundle();
        const [name, size] = [...bundleTextures(bundle)][0];
        await writeFile(resolveBundleAsset(directory, name), createBc1Dds(size.width, size.height));
        return bundle;
      }),
    ).rejects.toThrow();
    expect(await pathExists(path.join(root, key))).toBe(false);
    expect((await readdir(root)).filter((name) => name.startsWith(".pending-"))).toEqual([]);

    const published = await cache.getOrCreate(key, renderBundle);
    expect(published.bundle.issueId).toBe("issue-1");
  });

  it("should evict the least recently used bundle", async () => {
    const keyA = "1".repeat(64);
    const keyB = "2".repeat(64);
    const keyC = "3".repeat(64);
    const cache = new NewspaperCache(root, 1024 * 1024);
    await cache.getOrCreate(keyA, renderBundle);
    await cache.getOrCreate(keyB, renderBundle);
    const maxBytes = (await bundleBytes(keyA)) + (await bundleBytes(keyB));

    await utimes(path.join(root, keyA, "manifest.json"), new Date(1_000), new Date(1_000));
    await utimes(path.join(root, keyB, "manifest.json"), new Date(2_000), new Date(2_000));
    expect(await cache.read(keyA)).toBeDefined();

    const tighter = new NewspaperCache(root, maxBytes);
    await tighter.getOrCreate(keyC, renderBundle);

    expect(await pathExists(path.join(root, keyA))).toBe(true);
    expect(await pathExists(path.join(root, keyB))).toBe(false);
    expect(await pathExists(path.join(root, keyC))).toBe(true);
  });

  it("should honor the latest fixture pin from a later cache instance", async () => {
    const keyA = "a".repeat(64);
    const keyB = "b".repeat(64);
    const keyC = "c".repeat(64);
    const first = new NewspaperCache(root, 1024 * 1024);
    await first.getOrCreate(keyA, renderBundle);
    await first.getOrCreate(keyB, renderBundle);
    await first.pin(keyA);

    const second = new NewspaperCache(root, 1024 * 1024);
    await second.pin(keyB);
    expect(await readFile(path.join(root, "viewer.txt"), "utf8")).toBe(keyB);

    await utimes(path.join(root, keyA, "manifest.json"), new Date(2_000), new Date(2_000));
    await utimes(path.join(root, keyB, "manifest.json"), new Date(1_000), new Date(1_000));
    const maxBytes = (await bundleBytes(keyA)) + (await bundleBytes(keyB));
    const third = new NewspaperCache(root, maxBytes);
    await third.getOrCreate(keyC, renderBundle);

    expect(await pathExists(path.join(root, keyA))).toBe(false);
    expect(await pathExists(path.join(root, keyB))).toBe(true);
    expect(await pathExists(path.join(root, keyC))).toBe(true);
    expect(await readFile(path.join(root, "viewer.txt"), "utf8")).toBe(keyB);
  });
});
