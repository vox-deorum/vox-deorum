/**
 * @module utils/workspace/materialize
 *
 * Copy one version of a seat store out as ordinary files, so players and developers can read
 * notes and records outside the game. Reading uses its own read-only connection inside one read
 * transaction, so it sees a whole commit and works while a session writes the store.
 */

import fs from 'node:fs';
import path from 'node:path';
import { WorkspaceStore, type CommitID } from './workspace-store.js';

/** Receives a version's entries. Store paths have no leading slash; times are in milliseconds. */
export interface MaterializeSink {
  /** Called once per file, before any directory. */
  file(storePath: string, bytes: Uint8Array, mode: number, mtime: number): void;
  /** Called once per explicit directory after all files, deepest first. */
  directory(storePath: string, mode: number, mtime: number): void;
}

/**
 * Hand one version of a store, head by default, to a sink. Files come first in path order, then
 * explicit directories deepest first, so a sink can set directory times after filling them.
 *
 * @returns the commit that was materialized
 * @throws when the store file is missing or the commit is unknown
 */
export function materialize(dbPath: string, sink: MaterializeSink, commit?: CommitID): CommitID {
  if (!fs.existsSync(dbPath)) throw new Error(`No workspace store at ${dbPath}`);
  const store = WorkspaceStore.open(dbPath, { readonly: true });
  try {
    return store.readTransaction(() => {
      const id = commit ?? store.head();
      if (!store.hasCommit(id)) throw new Error(`Workspace store ${dbPath} has no commit ${id}`);
      const entries = [...store.manifest(id)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [storePath, entry] of entries) {
        if (entry.type === 'file') sink.file(storePath, store.readBlob(entry.hash), entry.mode, entry.mtime);
      }
      for (const [storePath, entry] of entries.reverse()) {
        if (entry.type === 'dir') sink.directory(storePath, entry.mode, entry.mtime);
      }
      return id;
    });
  } finally {
    store.close();
  }
}

/**
 * A sink that writes entries under `outDir`, which must be new or empty. Modes are applied as far
 * as the platform allows; on Windows only the read-only bit takes effect.
 *
 * @throws when `outDir` exists and is not an empty folder
 */
export function diskSink(outDir: string): MaterializeSink {
  const root = path.resolve(outDir);
  if (fs.existsSync(root) && (!fs.statSync(root).isDirectory() || fs.readdirSync(root).length > 0)) {
    throw new Error(`Output folder ${root} must be new or empty`);
  }
  fs.mkdirSync(root, { recursive: true });

  /** Resolve a store path under the output folder, refusing anything that escapes it. */
  const target = (storePath: string): string => {
    const resolved = path.resolve(root, storePath);
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Store path ${storePath} escapes ${root}`);
    return resolved;
  };

  return {
    file(storePath, bytes, mode, mtime) {
      const file = target(storePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      fs.chmodSync(file, mode);
      fs.utimesSync(file, new Date(mtime), new Date(mtime));
    },
    directory(storePath, mode, mtime) {
      const directory = target(storePath);
      fs.mkdirSync(directory, { recursive: true });
      fs.chmodSync(directory, mode);
      fs.utimesSync(directory, new Date(mtime), new Date(mtime));
    },
  };
}
