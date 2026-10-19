/**
 * @module utils/workspace/replay-workspace
 *
 * A disposable copy of a seat's workspace as it was at one recorded commit, for oracle replays.
 * Records, notes, and the reference come from the seat's store in its telemetry database, shared
 * folders come from disk, and every write stays in memory. Nothing is committed, so the store and
 * the shared folders are never changed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Bash, InMemoryFs, MountableFs, OverlayFs, type MountConfig } from 'just-bash';
import type { ResolvedFilesConfig } from '../../types/config.js';
import { errorMessage } from '../errors.js';
import { StoreFs } from './store-fs.js';
import { WorkspaceStore, type CommitID } from './workspace-store.js';
import {
  cancelledMessage,
  capOutput,
  failure,
  workspaceCwd,
  workspaceGuide,
  workspaceGuideFile,
  workspaceMounts,
  type Workspace,
  type WorkspaceExecResult,
} from './player-workspace.js';

/** Where a replay workspace's contents come from. */
export interface ReplayWorkspaceOptions {
  /** The telemetry database that holds the seat's store. */
  dbPath: string;
  /** The recorded files setting of the run being replayed. */
  files: ResolvedFilesConfig;
  gameID: string;
  playerID: number;
  /** The recorded store commit the run started from. */
  commit: CommitID;
  /** The folder that holds the shared folders, `<telemetryDir>/workspaces/shared`. */
  sharedRoot: string;
}

/**
 * One replay execution's workspace. Each mount is built once, so writes made by one command are
 * visible to the next commands of the same execution, while separate workspaces never see each
 * other's writes. Close it to release the store connection.
 */
export class ReplayWorkspace implements Workspace {
  /** Wrap opened mounts; use {@link ReplayWorkspace.open}. */
  private constructor(private readonly store: WorkspaceStore, private readonly mounts: MountConfig[]) {}

  /**
   * Open a workspace pinned to a commit. The game folder is read-write or read-only as recorded; a
   * writable game folder without a guide gets the default guide in memory, as the live workspace
   * would have added it. Writable shared folders get the shared guide the same way.
   *
   * @throws when the database has no store or the commit is unknown
   */
  static async open(options: ReplayWorkspaceOptions): Promise<ReplayWorkspace> {
    const { dbPath, files, gameID, playerID, commit, sharedRoot } = options;
    if (!WorkspaceStore.hasStore(dbPath)) throw new Error(`No workspace store in ${dbPath}`);
    const store = WorkspaceStore.open(dbPath, { readonly: true });
    try {
      if (!store.hasCommit(commit)) throw new Error(`Workspace store ${dbPath} has no commit ${commit}`);
      const manifest = store.manifest(commit);
      // The mount list's real paths sit under a root whose `shared/` folder is the shared root.
      const layout = workspaceMounts(files, gameID, playerID, path.dirname(sharedRoot));
      const mounts: MountConfig[] = [];
      for (const mount of layout) {
        if ('storePrefix' in mount) {
          const view = new StoreFs(store, manifest, mount.storePrefix, { readOnly: mount.access !== 'write' });
          if (mount.scope === 'game' && mount.access === 'write') {
            await seedGuide(view, workspaceGuide('game', files));
          }
          mounts.push({ mountPoint: mount.virtualPath, filesystem: view });
        } else if (mount.scope === 'shared') {
          mounts.push({ mountPoint: mount.virtualPath, filesystem: await sharedFilesystem(store, mount.realPath, mount.access === 'write') });
        } else {
          mounts.push({ mountPoint: mount.virtualPath, filesystem: new InMemoryFs() });
        }
      }
      return new ReplayWorkspace(store, mounts);
    } catch (error) {
      store.close();
      throw error;
    }
  }

  /**
   * Run one bash script against the copy. Failures come back as stderr with exit code 1, and a
   * cancelled run fails. Nothing is committed, so the commit info is ignored.
   *
   * @param command - The script to run
   * @param signal - The run signal that cancels the script
   */
  async exec(command: string, signal?: AbortSignal): Promise<WorkspaceExecResult> {
    try {
      const filesystem = new MountableFs({ base: new InMemoryFs(), mounts: this.mounts });
      const bash = new Bash({ fs: filesystem, cwd: workspaceCwd, python: false, javascript: true });
      const result = await bash.exec(command, { signal });
      if (signal?.aborted) return failure(cancelledMessage);
      return { stdout: capOutput(result.stdout), stderr: capOutput(result.stderr), exitCode: result.exitCode };
    } catch (error) {
      if (signal?.aborted) return failure(cancelledMessage);
      return failure(errorMessage(error));
    }
  }

  /** Close the store connection. */
  close(): void {
    this.store.close();
  }
}

/** Write a guide at a writable view's root unless one is already there. */
async function seedGuide(view: { exists(path: string): Promise<boolean>; writeFile(path: string, content: string): Promise<void> }, guide: string): Promise<void> {
  const guidePath = `/${workspaceGuideFile}`;
  if (!(await view.exists(guidePath))) await view.writeFile(guidePath, guide);
}

/**
 * A shared folder as an in-memory overlay of its current contents on disk, writable or read-only
 * as recorded. A missing folder appears empty: writable as a plain memory folder, or read-only as
 * an empty store view, which rejects writes the way a read-only overlay does.
 */
async function sharedFilesystem(store: WorkspaceStore, realPath: string, writable: boolean): Promise<MountConfig['filesystem']> {
  let filesystem: MountConfig['filesystem'];
  if (fs.existsSync(realPath)) {
    filesystem = new OverlayFs({ root: fs.realpathSync.native(realPath), readOnly: !writable, mountPoint: '/' });
  } else if (writable) {
    filesystem = new InMemoryFs();
  } else {
    return new StoreFs(store, new Map(), 'shared/', { readOnly: true });
  }
  if (writable) await seedGuide(filesystem, workspaceGuide('shared'));
  return filesystem;
}
