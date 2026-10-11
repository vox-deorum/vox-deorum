/**
 * @module utils/workspace/store-fs
 *
 * A just-bash filesystem view of one folder of a {@link WorkspaceStore} version. Files load their
 * contents from the store on first read. The view notes which paths each mutator touched, so the
 * caller can commit their final state after a command.
 */

import path from 'node:path';
import { InMemoryFs, type BufferEncoding, type CpOptions, type CreateExclusiveOptions, type FileContent, type MkdirOptions, type RmOptions } from 'just-bash';
import type { Manifest, PathChange, WorkspaceStore } from './workspace-store.js';

/** WriteFile options as just-bash's filesystem interface accepts them. */
type WriteOptions = { encoding?: BufferEncoding } | BufferEncoding;

/** Order store changes by path. */
function byPath(a: PathChange, b: PathChange): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** Normalize a view path to an absolute POSIX path. */
function normalize(viewPath: string): string {
  return path.posix.resolve('/', viewPath);
}

/**
 * A view of the store paths under `prefix` (for example `game/`), mounted at `/`. The writable
 * variant tracks touched paths; the read-only variant rejects every write with `EROFS`, as the
 * read-only disk mounts do. Links are always rejected because the store has no link entries.
 */
export class StoreFs extends InMemoryFs {
  private readonly touched = new Set<string>();
  /** Copy and move destinations, whose contents are walked at commit time. */
  private readonly walked = new Set<string>();
  /** Paths removed by `rm` or moved away by `mv`, which may have been recreated afterwards. */
  private readonly removed = new Set<string>();
  private readonly readOnly: boolean;

  /**
   * @param store - The store that holds the file contents
   * @param manifest - The version to show
   * @param prefix - The store folder to show, ending with `/`, such as `records/` or `game/`
   * @param options - `readOnly` rejects writes
   */
  constructor(store: WorkspaceStore, private readonly manifest: Manifest, private readonly prefix: string, options: { readOnly?: boolean } = {}) {
    super();
    if (!prefix.endsWith('/')) throw new Error(`Store view prefix must end with '/': ${prefix}`);
    this.readOnly = options.readOnly ?? false;
    for (const [storePath, entry] of manifest) {
      if (!storePath.startsWith(prefix)) continue;
      const viewPath = `/${storePath.slice(prefix.length)}`;
      if (entry.type === 'file') {
        this.writeFileLazy(viewPath, () => store.readBlob(entry.hash), { mode: entry.mode, mtime: new Date(entry.mtime) });
      } else {
        this.mkdirSync(viewPath, { recursive: true });
        this.setDirMetadata(viewPath, entry.mode, entry.mtime);
      }
    }
  }

  /** Mark a view path (leading slash) touched, so its final state is committed. */
  touch(viewPath: string): void {
    this.touched.add(normalize(viewPath));
  }

  /**
   * The final state of every touched path as store changes: a file with its bytes, mode, and
   * modification time, a directory with its mode and time (plus everything under a copy or move
   * destination), or a delete. Deletes of paths absent from the original version and deletes
   * under another deleted path are left out. A stored path that was removed and then recreated
   * comes first as a delete, followed by everything now under it, so no old contents survive.
   */
  async touchedChanges(): Promise<PathChange[]> {
    const changes = new Map<string, PathChange>();
    const resets: PathChange[] = [];
    const walked = new Set(this.walked);
    for (const viewPath of this.removed) {
      const storePath = `${this.prefix}${viewPath.slice(1)}`;
      if (viewPath === '/' || !this.existedBefore(storePath) || !(await this.exists(viewPath))) continue;
      resets.push({ path: storePath, type: 'delete' });
      walked.add(viewPath);
      this.touched.add(viewPath);
    }
    const visit = async (viewPath: string, walk: boolean): Promise<void> => {
      if (viewPath !== '/') {
        const storePath = `${this.prefix}${viewPath.slice(1)}`;
        if (!(await this.exists(viewPath))) {
          changes.set(storePath, { path: storePath, type: 'delete' });
          return;
        }
        const stat = await this.lstat(viewPath);
        if (stat.isFile) {
          const content = await this.readFileBuffer(viewPath);
          changes.set(storePath, { path: storePath, type: 'file', content, mode: stat.mode, mtime: stat.mtime.getTime() });
          return;
        }
        changes.set(storePath, { path: storePath, type: 'dir', mode: stat.mode, mtime: stat.mtime.getTime() });
      }
      if (!walk || !(await this.exists(viewPath))) return;
      for (const name of await this.readdir(viewPath)) await visit(path.posix.join(viewPath, name), true);
    };
    for (const viewPath of this.touched) await visit(viewPath, walked.has(viewPath));

    const deleted = [...changes.values()].filter((change) => change.type === 'delete').map((change) => change.path);
    return [...resets.sort(byPath), ...[...changes.values()]
      .filter((change) => change.type !== 'delete'
        || (this.existedBefore(change.path) && !deleted.some((other) => change.path.startsWith(`${other}/`))))
      .sort(byPath)];
  }

  /** Write a file and note the path. */
  override async writeFile(viewPath: string, content: FileContent, options?: WriteOptions): Promise<void> {
    this.mutate('write', viewPath);
    return super.writeFile(viewPath, content, options);
  }

  /** Append to a file and note the path. */
  override async appendFile(viewPath: string, content: FileContent, options?: WriteOptions): Promise<void> {
    this.mutate('append', viewPath);
    return super.appendFile(viewPath, content, options);
  }

  /** Create a directory and note the path, plus any missing parents a recursive call creates. */
  override async mkdir(viewPath: string, options?: MkdirOptions): Promise<void> {
    this.mutate('mkdir', viewPath);
    if (options?.recursive) {
      for (let parent = path.posix.dirname(normalize(viewPath)); parent !== '/' && !(await this.exists(parent)); parent = path.posix.dirname(parent)) {
        this.touch(parent);
      }
    }
    return super.mkdir(viewPath, options);
  }

  /** Remove a path and note it. */
  override async rm(viewPath: string, options?: RmOptions): Promise<void> {
    this.mutate('rm', viewPath);
    this.removed.add(normalize(viewPath));
    return super.rm(viewPath, options);
  }

  /** Copy a path and note the destination, whose contents are walked at commit time. */
  override async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    this.mutate('cp', dest);
    this.walked.add(normalize(dest));
    return super.cp(src, dest, options);
  }

  /** Move a path and note both ends; the destination's contents are walked at commit time. */
  override async mv(src: string, dest: string): Promise<void> {
    this.mutate('mv', dest);
    this.touch(src);
    this.removed.add(normalize(src));
    this.walked.add(normalize(dest));
    return super.mv(src, dest);
  }

  /** Change a path's mode and note it. */
  override async chmod(viewPath: string, mode: number): Promise<void> {
    this.mutate('chmod', viewPath);
    return super.chmod(viewPath, mode);
  }

  /** Change a path's modification time and note it. */
  override async utimes(viewPath: string, atime: Date, mtime: Date): Promise<void> {
    this.mutate('utimes', viewPath);
    return super.utimes(viewPath, atime, mtime);
  }

  /** Create a new file or directory exclusively and note the path. */
  override async createExclusive(viewPath: string, options: CreateExclusiveOptions): Promise<void> {
    this.mutate(options.directory ? 'mkdir' : 'open', viewPath);
    return super.createExclusive(viewPath, options);
  }

  /** Reject symbolic links, which the store cannot hold. */
  override async symlink(_target: string, linkPath: string): Promise<void> {
    this.assertWritable('symlink', linkPath);
    throw new Error(`EPERM: links are not supported in this workspace folder, symlink '${linkPath}'`);
  }

  /** Reject hard links, which the store cannot hold. */
  override async link(_existingPath: string, newPath: string): Promise<void> {
    this.assertWritable('link', newPath);
    throw new Error(`EPERM: links are not supported in this workspace folder, link '${newPath}'`);
  }

  /** Check that the view is writable, then note the path. */
  private mutate(operation: string, viewPath: string): void {
    this.assertWritable(operation, viewPath);
    this.touch(viewPath);
  }

  /** Throw the same `EROFS` error as just-bash's read-only `OverlayFs` when the view is read-only. */
  private assertWritable(operation: string, viewPath: string): void {
    if (this.readOnly) throw new Error(`EROFS: read-only file system, ${operation} '${viewPath}'`);
  }

  /**
   * Apply a stored directory's mode and time without tracking. InMemoryFs's `chmod` and `utimes`
   * update the entry before their first await, so the change is in place when they return.
   */
  private setDirMetadata(viewPath: string, mode: number, mtime: number): void {
    super.chmod(viewPath, mode).catch(() => undefined);
    super.utimes(viewPath, new Date(mtime), new Date(mtime)).catch(() => undefined);
  }

  /** Whether a store path or anything under it was in the version this view was built from. */
  private existedBefore(storePath: string): boolean {
    if (this.manifest.has(storePath)) return true;
    const prefix = `${storePath}/`;
    for (const key of this.manifest.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }
}
