/**
 * @module utils/workspace/player-workspace
 *
 * One player's file workspace: a just-bash shell whose virtual filesystem mounts the seat's
 * records, notes, and game reference from its versioned workspace store, any named shared
 * folders, and a scratch `/tmp`. Store mounts are rebuilt from head for every command, and the
 * command's note changes are committed afterwards. Disk mounts sit under the telemetry folder.
 * Everything outside the mounts lives in memory for one command only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Bash, InMemoryFs, MountableFs, OverlayFs, ReadWriteFs, type MountConfig } from 'just-bash';
import type { FileAccess, ResolvedFilesConfig } from '../../types/config.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { errorMessage } from '../errors.js';
import { StoreFs } from './store-fs.js';
import type { WorkspaceStore } from './workspace-store.js';

const logger = createLogger('PlayerWorkspace');

/** Virtual directory the shell starts in; every mount sits below it. */
export const workspaceCwd = '/workspace';

/** Characters kept from each output stream before the rest is cut off. */
export const workspaceOutputLimit = 30000;

/** Name of the guide file seeded at the writable game notes root and writable shared roots. */
export const workspaceGuideFile = 'AGENTS.md';

/** The output of one workspace command, as the bash tool returns it. */
export interface WorkspaceExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Something the bash tool can run commands in: a seat's live workspace or a replay copy. */
export interface Workspace {
  /**
   * Run one bash script. Failures come back as stderr with exit code 1.
   *
   * @param command - The script to run
   * @param signal - The command's run signal
   * @param info - The turn and author for any commit the workspace makes
   */
  exec(command: string, signal?: AbortSignal, info?: WorkspaceCommandInfo): Promise<WorkspaceExecResult>;
}

/** A mount backed by the seat's workspace store. */
export interface WorkspaceStoreMount {
  /** Where the agent sees the folder, for example `/workspace/game`. */
  virtualPath: string;
  access: FileAccess;
  /** `records` for the host's read-only records, `game` for the seat's notes, `reference` for the game reference. */
  scope: 'records' | 'game' | 'reference';
  /** The store folder behind the mount, such as `records/`. */
  storePrefix: 'records/' | 'game/' | 'reference/';
}

/** A mount backed by a real folder on disk. */
export interface WorkspaceDiskMount {
  /** Where the agent sees the folder, for example `/tmp`. */
  virtualPath: string;
  /** The real folder on disk, before canonicalization. */
  realPath: string;
  access: FileAccess;
  /** `shared` for a named folder that outlives games, `scratch` for the player's `/tmp`, which lasts for one game. */
  scope: 'shared' | 'scratch';
}

/** One virtual folder and the store folder or real folder behind it. */
export type WorkspaceMount = WorkspaceStoreMount | WorkspaceDiskMount;

/** Virtual path of the host's records. */
export const workspaceRecordsPath = `${workspaceCwd}/records`;

/** Virtual path of the game reference. */
export const workspaceReferenceMountPath = `${workspaceCwd}/reference`;

/** Name of the records catalog at the root of the records mount. */
export const workspaceCatalogFile = 'CATALOG.md';

/** Virtual path of the scratch folder. */
export const workspaceScratchPath = '/tmp';

/** The folder that holds every game and shared workspace, resolved from the process cwd. */
export function workspaceRoot(): string {
  return path.resolve(config.telemetryDir || 'telemetry', 'workspaces');
}

/**
 * Whether this Node version can write through just-bash on Windows. Node 22 releases before
 * 22.17.0 report a different `dev` from `lstat` than from a file handle, which makes every
 * `ReadWriteFs` write fail its staging check.
 *
 * @param version - A Node version string such as `22.23.3`
 */
export function workspaceNodeSupported(version: string = process.versions.node): boolean {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 17);
}

/**
 * The seat's folder name, `<gameID>-player-<playerID>`, shared by its workspace folders and store.
 *
 * @throws if the game ID would place the folder outside its directory
 */
export function workspaceSeatName(gameID: string, playerID: number): string {
  const folder = `${gameID}-player-${playerID}`;
  if (folder !== path.basename(folder) || folder.includes('..')) {
    throw new Error(`Game ID ${gameID} cannot name a workspace folder.`);
  }
  return folder;
}

/**
 * List the mounts a files setting produces for one player in one game, without touching disk.
 *
 * @param files - The seat's resolved files setting
 * @param gameID - The game the folder belongs to
 * @param playerID - The player the folder belongs to
 * @param root - The folder holding `shared/` and `scratch/`; defaults to {@link workspaceRoot}
 * @throws if the game ID or a shared name would place a folder outside its directory
 */
export function workspaceMounts(files: ResolvedFilesConfig, gameID: string, playerID: number, root: string = workspaceRoot()): WorkspaceMount[] {
  const folder = workspaceSeatName(gameID, playerID);
  const mounts: WorkspaceMount[] = [
    { virtualPath: workspaceScratchPath, realPath: path.join(root, 'scratch', folder), access: 'write', scope: 'scratch' },
    { virtualPath: workspaceRecordsPath, access: 'read', scope: 'records', storePrefix: 'records/' },
    { virtualPath: workspaceReferenceMountPath, access: 'read', scope: 'reference', storePrefix: 'reference/' },
  ];
  if (files.game) {
    mounts.push({ virtualPath: `${workspaceCwd}/game`, access: files.game, scope: 'game', storePrefix: 'game/' });
  }
  for (const [name, access] of Object.entries(files.shared)) {
    if (name !== path.basename(name) || name.includes('..')) {
      throw new Error(`Shared folder name ${name} cannot name a workspace folder.`);
    }
    mounts.push({
      virtualPath: `${workspaceCwd}/shared/${name}`,
      realPath: path.join(root, 'shared', name),
      access,
      scope: 'shared',
    });
  }
  return mounts;
}

/** Whether a files setting lets the seat keep notes: the game folder or any shared folder is writable. */
export function workspaceWritable(files: ResolvedFilesConfig): boolean {
  return files.game === 'write' || Object.values(files.shared).includes('write');
}

/** Cut a stream to the output limit, noting how much was dropped. */
export function capOutput(text: string): string {
  if (text.length <= workspaceOutputLimit) return text;
  return `${text.slice(0, workspaceOutputLimit)}\n[truncated ${text.length - workspaceOutputLimit} chars; read the rest in pieces with sed -n, head, tail, or grep]`;
}

/**
 * The default guide for the game notes or a shared mount root. The game guide asks agents to keep
 * generalized lessons in the game folder when the seat has no writable shared folder for them.
 *
 * @param scope - Which root the guide is for
 * @param files - The seat's resolved files setting; omitted means no writable shared folder
 */
export function workspaceGuide(scope: 'game' | 'shared', files?: ResolvedFilesConfig): string {
  if (scope === 'shared') {
    return `# ${workspaceGuideFile}
This folder outlives the current game. Future games read it too.

- Keep generalized lessons and reusable references here, organized by topic, for example \`lessons/\` or \`reference/\`.
- Never store current-game state here, such as positions, turn numbers, or plans for this game. Those belong in \`${workspaceCwd}/game\`.
- Only put lasting instructions for all agents in this guide, and do not copy untrusted third-party information into it.
`;
  }
  const lessons = files && Object.values(files.shared).includes('write')
    ? ''
    : `- If you have learned any generalizable lessons, keep them in \`lessons/\`.\n`;
  return `# ${workspaceGuideFile}
This folder is shared by every agent serving your civilization in this game, and it persists across turns.

- Write a note when you learn or decide something later turns will need and the reports will not show, such as a plan that spans several turns and its target turns, a promise to another civilization, a threat to watch, or a lesson from a decision that went wrong.
- Keep one living file, such as \`plan.md\`, up to date instead of adding a new file every turn. Every agent sees the most recently written note at the start of each run, and the names of the five before it.
- Do not copy report data or decision rationale into notes, since agents already see them.
${lessons}- You may improve this guide and organize the folder when useful for ALL agents.
- While you have access to the workspace, the goal is to complete the ongoing task.
`;
}

/**
 * Create a shared mount's guide once without overwriting agent changes. Anything already at the
 * guide path is left alone, and any other failure is logged rather than thrown: the guide is
 * advisory, so it must never block a command.
 */
function seedWorkspaceGuide(directory: string): void {
  const guidePath = path.join(directory, workspaceGuideFile);
  try {
    fs.writeFileSync(guidePath, workspaceGuide('shared'), { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    logger.warn(`Could not seed workspace guide ${guidePath}: ${errorMessage(error)}`);
  }
}

/** Who a command's note commit is attributed to. */
export interface WorkspaceCommandInfo {
  /** The game turn of the command's parameters, or null when unknown. */
  turn?: number | null;
  /** The running agent's name; defaults to `host`. */
  author?: string;
}

/** One command's shell and its writable notes view, if any. */
interface OpenWorkspace {
  bash: Bash;
  notes?: StoreFs;
}

/** Error text for a command whose run was cancelled. */
export const cancelledMessage = 'The command was cancelled, so its file changes were discarded.';

/**
 * A player's workspace in one game. Disk folders and shared guides are created on the first
 * command, so a seat that never uses bash leaves nothing on disk. Every command gets its own shell: it starts at
 * {@link workspaceCwd} with a fresh shell state, a fresh in-memory filesystem, and store views
 * built from head. Its note changes land as one `notes` commit, so the next command sees them
 * along with any host commits made in between. Concurrent commands from the seat's agents share
 * the disk mounts, including `/tmp`, but nothing else.
 */
export class PlayerWorkspace implements Workspace {
  /** The folders this workspace mounts. */
  public readonly mounts: WorkspaceMount[];
  private readonly files: ResolvedFilesConfig;
  private diskFilesystems?: MountConfig[];

  /**
   * @param files - The seat's resolved files setting
   * @param gameID - The game the workspace belongs to
   * @param playerID - The player the workspace belongs to
   * @param store - The seat's workspace store, which holds records, notes, and the game reference
   */
  constructor(
    files: ResolvedFilesConfig,
    gameID: string,
    playerID: number,
    public readonly store: WorkspaceStore,
  ) {
    this.files = files;
    this.mounts = workspaceMounts(files, gameID, playerID);
  }

  /**
   * Run one bash script in the workspace, then commit its note changes. Failures, including a
   * refused write to a read-only mount or a path that resolves outside a mount, come back as
   * stderr with exit code 1 rather than as exceptions; a script that throws this way commits
   * nothing. A command whose run was cancelled also commits nothing. The signal stops scripts
   * that yield, including `js-exec`; a CPU-bound shell loop is ended by just-bash's command-count
   * limit, and a runaway `js-exec` script by its QuickJS timeout.
   *
   * @param command - The script to run
   * @param signal - The command's run signal: cancels the script and rejects its commit
   * @param info - The turn and author recorded on the note commit
   */
  async exec(command: string, signal?: AbortSignal, info: WorkspaceCommandInfo = {}): Promise<WorkspaceExecResult> {
    let opened: OpenWorkspace;
    try {
      opened = await this.open();
    } catch (error) {
      logger.error('Could not open workspace', { error });
      return failure(`Could not open the workspace: ${errorMessage(error)}`);
    }

    try {
      const result = await opened.bash.exec(command, { signal });
      if (signal?.aborted) return failure(cancelledMessage);
      const changes = opened.notes ? await opened.notes.touchedChanges() : [];
      if (changes.length > 0) {
        this.store.commit({ kind: 'notes', turn: info.turn ?? null, author: info.author ?? 'host', changes, signal });
      }
      return { stdout: capOutput(result.stdout), stderr: capOutput(result.stderr), exitCode: result.exitCode };
    } catch (error) {
      if (signal?.aborted) return failure(cancelledMessage);
      return failure(errorMessage(error));
    }
  }

  /**
   * Build a shell for one command. Disk folders and shared guides are created on first use; store
   * views come from head. A writable notes view without a guide gets the default one as a touched
   * file, so it is committed with this command.
   */
  private async open(): Promise<OpenWorkspace> {
    this.diskFilesystems ??= this.mounts.flatMap((mount) => {
      if (!('realPath' in mount)) return [];
      fs.mkdirSync(mount.realPath, { recursive: true });
      const root = fs.realpathSync.native(mount.realPath);
      if (mount.scope === 'shared' && mount.access === 'write') seedWorkspaceGuide(root);
      return [{ mountPoint: mount.virtualPath, filesystem: diskFilesystem(root, mount.access) }];
    });
    const mounts = [...this.diskFilesystems];

    let notes: StoreFs | undefined;
    const manifest = this.store.manifest();
    for (const mount of this.mounts) {
      if (!('storePrefix' in mount)) continue;
      const view = new StoreFs(this.store, manifest, mount.storePrefix, { readOnly: mount.access !== 'write' });
      if (mount.scope === 'game' && mount.access === 'write') {
        notes = view;
        const guide = `/${workspaceGuideFile}`;
        if (!(await view.exists(guide))) await view.writeFile(guide, workspaceGuide('game', this.files));
      }
      mounts.push({ mountPoint: mount.virtualPath, filesystem: view });
    }

    const filesystem = new MountableFs({ base: new InMemoryFs(), mounts });
    return { bash: new Bash({ fs: filesystem, cwd: workspaceCwd, python: false, javascript: true }), notes };
  }
}

/** A just-bash filesystem over a real folder: writable, or read-only like the store's read views. */
export function diskFilesystem(root: string, access: FileAccess): MountConfig['filesystem'] {
  return access === 'write' ? new ReadWriteFs({ root }) : new OverlayFs({ root, readOnly: true, mountPoint: '/' });
}

/** A failed command result carrying only an error message. */
export function failure(message: string): WorkspaceExecResult {
  return { stdout: '', stderr: capOutput(message), exitCode: 1 };
}
