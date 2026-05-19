import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// Support both local development (repo root) and installed/dist execution where
// the compiled module may resolve relative paths differently.
const defaultCacheDirs = [
  path.resolve(moduleDir, '../../../scripts/.dll-cache'),
  path.resolve(process.cwd(), 'scripts/.dll-cache'),
  path.resolve(process.cwd(), '../scripts/.dll-cache')
];

export interface VpVersionMetadata {
  vpVersion?: string;
  vpDllVersion?: string;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export async function readDllCacheValue(
  fileName: string,
  cacheDirs: string[] = defaultCacheDirs
): Promise<string | undefined> {
  for (const cacheDir of unique(cacheDirs)) {
    try {
      const value = (await fs.readFile(path.join(cacheDir, fileName), 'utf-8')).trim();
      if (value.length > 0) return value;
    } catch (error) {
      // Older installs may not have these metadata files yet; callers decide
      // whether a missing value is noteworthy.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
  }

  return undefined;
}

export async function readVpVersionMetadata(): Promise<VpVersionMetadata> {
  // version.txt is the semantic VP release; release-tag.txt is the DLL build.
  const [vpVersion, vpDllVersion] = await Promise.all([
    readDllCacheValue('version.txt'),
    readDllCacheValue('release-tag.txt')
  ]);

  return { vpVersion, vpDllVersion };
}
