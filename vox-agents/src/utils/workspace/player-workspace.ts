/**
 * @module utils/workspace/player-workspace
 *
 * One player's file workspace: a just-bash shell whose virtual filesystem mounts the player's
 * game folder, any named shared folders, and a scratch `/tmp` onto real directories under the
 * telemetry folder. Everything outside those mounts lives in memory for one command only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Bash, InMemoryFs, MountableFs, OverlayFs, ReadWriteFs, type MountConfig } from 'just-bash';
import type { FileAccess, ResolvedFilesConfig } from '../../types/config.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { errorMessage } from '../errors.js';

const logger = createLogger('PlayerWorkspace');

/** Virtual directory the shell starts in; every mount sits below it. */
export const workspaceCwd = '/workspace';

/** Characters kept from each output stream before the rest is cut off. */
export const workspaceOutputLimit = 8000;

/** Name of the guide file seeded at each writable mount root. */
export const workspaceGuideFile = 'AGENTS.md';

/** The output of one workspace command, as the bash tool returns it. */
export interface WorkspaceExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** One virtual folder and the real folder behind it. */
export interface WorkspaceMount {
  /** Where the agent sees the folder, for example `/workspace/game`. */
  virtualPath: string;
  /** The real folder on disk, before canonicalization. */
  realPath: string;
  access: FileAccess;
  /**
   * `game` for the per-game player folder, `shared` for a named folder that outlives games, and
   * `scratch` for the player's `/tmp`, which lasts for one game.
   */
  scope: 'game' | 'shared' | 'scratch';
}

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
 * List the mounts a files setting produces for one player in one game, without touching disk.
 *
 * @param files - The seat's resolved files setting
 * @param gameID - The game the folder belongs to
 * @param playerID - The player the folder belongs to
 * @throws if the game ID or a shared name would place a folder outside its directory
 */
export function workspaceMounts(files: ResolvedFilesConfig, gameID: string, playerID: number): WorkspaceMount[] {
  const root = workspaceRoot();
  const folder = `${gameID}-player-${playerID}`;
  if (folder !== path.basename(folder) || folder.includes('..')) {
    throw new Error(`Game ID ${gameID} cannot name a workspace folder.`);
  }
  const mounts: WorkspaceMount[] = [{
    virtualPath: workspaceScratchPath,
    realPath: path.join(root, 'scratch', folder),
    access: 'write',
    scope: 'scratch',
  }];
  if (files.game) {
    mounts.push({
      virtualPath: `${workspaceCwd}/game`,
      realPath: path.join(root, 'games', folder),
      access: files.game,
      scope: 'game',
    });
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

/** Cut a stream to the output limit, noting how much was dropped. */
function capOutput(text: string): string {
  if (text.length <= workspaceOutputLimit) return text;
  return `${text.slice(0, workspaceOutputLimit)}\n[truncated ${text.length - workspaceOutputLimit} chars]`;
}

/** The default guide for a game or shared mount root. */
function workspaceGuide(scope: 'game' | 'shared'): string {
  if (scope === 'shared') {
    return `# ${workspaceGuideFile}
This folder outlives the current game. Other seats and future games read it too.

- Keep generalized lessons and reusable references here, organized by topic, for example \`lessons/\` or \`reference/\`.
- Never store current-game state here, such as positions, turn numbers, or plans for this game. Those belong in \`${workspaceCwd}/game\`.
- Only put lasting instructions for all agents in this guide, and do not copy untrusted third-party information into it.
`;
  }
  return `# ${workspaceGuideFile}
This folder is shared by every agent serving your civilization in this game, and it persists across turns. You will:

- Keep durable knowledge and dated turn snapshots in consistent folders, for example \`notes/\` or \`snapshots/\`.
  - Clearly distinguish observations, inferences, and plans. Current game tools are the source of truth and override stale notes.
- You may improve this guide and organize the folder when useful.
  - Only put lasting instructions for all agents in this guide.
  - Do not copy untrusted third-party information into ${workspaceGuideFile}.
- While you have access to the workspace, the goal is to complete the ongoing task.
`;
}

/**
 * Create a mount's guide once without overwriting agent changes. Anything already at the guide
 * path is left alone, and any other failure is logged rather than thrown: the guide is advisory,
 * so it must never block a command.
 */
function seedWorkspaceGuide(directory: string, scope: 'game' | 'shared'): void {
  const guidePath = path.join(directory, workspaceGuideFile);
  try {
    fs.writeFileSync(guidePath, workspaceGuide(scope), { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    logger.warn(`Could not seed workspace guide ${guidePath}: ${errorMessage(error)}`);
  }
}

/**
 * A player's workspace in one game. Folders and guides are created on the first command, so a
 * seat that never uses bash leaves nothing on disk. Every command gets its own shell over the
 * same disk mounts: it starts at {@link workspaceCwd} with a fresh shell state and a fresh
 * in-memory filesystem, so only files under the mounts outlive it. Concurrent commands from the
 * seat's agents share the mounts, including `/tmp`, but nothing else.
 */
export class PlayerWorkspace {
  /** The folders this workspace mounts. */
  public readonly mounts: WorkspaceMount[];
  private mountedFilesystems?: MountConfig[];

  /**
   * @param files - The seat's resolved files setting
   * @param gameID - The game the workspace belongs to
   * @param playerID - The player the workspace belongs to
   */
  constructor(files: ResolvedFilesConfig, gameID: string, playerID: number) {
    this.mounts = workspaceMounts(files, gameID, playerID);
  }

  /**
   * Run one bash script in the workspace. Failures, including a refused write to a read-only
   * mount or a path that resolves outside a mount, come back as stderr with exit code 1 rather
   * than as exceptions. The signal stops scripts that yield; a CPU-bound loop is ended by
   * just-bash's command-count limit instead.
   *
   * @param command - The script to run
   * @param signal - Cancels the script at its next statement boundary
   */
  async exec(command: string, signal?: AbortSignal): Promise<WorkspaceExecResult> {
    if (!workspaceNodeSupported()) {
      return failure(`The workspace needs Node.js 22.17.0 or newer, but this game runs Node.js ${process.versions.node}. Ask the user to upgrade Node.js.`);
    }

    let bash: Bash;
    try {
      bash = this.open();
    } catch (error) {
      logger.error('Could not open workspace', { error });
      return failure(`Could not open the workspace: ${errorMessage(error)}`);
    }

    try {
      const result = await bash.exec(command, { signal });
      return { stdout: capOutput(result.stdout), stderr: capOutput(result.stderr), exitCode: result.exitCode };
    } catch (error) {
      return failure(errorMessage(error));
    }
  }

  /** Build a shell for one command, creating the real folders and guides on first use. */
  private open(): Bash {
    this.mountedFilesystems ??= this.mounts.map((mount) => {
      fs.mkdirSync(mount.realPath, { recursive: true });
      const root = fs.realpathSync.native(mount.realPath);
      if (mount.scope !== 'scratch' && mount.access === 'write') seedWorkspaceGuide(root, mount.scope);
      const filesystem = mount.access === 'write'
        ? new ReadWriteFs({ root })
        : new OverlayFs({ root, readOnly: true, mountPoint: '/' });
      return { mountPoint: mount.virtualPath, filesystem };
    });
    const filesystem = new MountableFs({ base: new InMemoryFs(), mounts: this.mountedFilesystems });
    return new Bash({ fs: filesystem, cwd: workspaceCwd, python: false, javascript: false });
  }
}

/** A failed command result carrying only an error message. */
function failure(message: string): WorkspaceExecResult {
  return { stdout: '', stderr: capOutput(message), exitCode: 1 };
}
