/**
 * Shared host meta-tool policy for providers that can execute local capabilities.
 */

import fs from 'node:fs';
import path from 'node:path';
import { everythingHostTools, hostMetaTools } from '../../../types/config.js';
import type { HostMetaTool } from '../../../types/config.js';
import { createLogger } from '../../logger.js';

export { everythingHostTools, hostMetaTools } from '../../../types/config.js';
export type { HostMetaTool } from '../../../types/config.js';

const logger = createLogger('HostTools');

/** Identifies runtime-owned resources that providers may isolate by working directory. */
export interface ModelRuntimeIdentity {
  workingDirId?: string;
}

/** The normalized host capabilities without a provider working directory. */
export interface HostToolCapabilities {
  read: boolean;
  write: boolean;
  web: boolean;
}

/** The resolved capability set and the isolated working directory backing it. */
export interface HostToolAccess extends HostToolCapabilities {
  workingDirectory?: string;
}

/** Provider-specific inputs used to resolve the shared host-tool access. */
export interface HostToolAccessOptions extends ModelRuntimeIdentity {
  /** Absolute directory under which per-run working directories are created. */
  workingDirectoryBase: string;
  /** Meta-tools whose enabled access requires an isolated working directory. */
  workingDirectoryTools?: readonly HostMetaTool[];
}

/**
 * Guide files seeded in host-enabled agent workspaces, keyed by provider id. The
 * keys also define which providers can execute host capabilities at all.
 */
export const hostWorkspaceGuideFiles = {
  codex: 'AGENTS.md',
  'claude-code': 'CLAUDE.md',
} as const;

/** A provider whose configured host tools are available during model execution. */
export type HostCapabilityProvider = keyof typeof hostWorkspaceGuideFiles;

/** Narrows a configured provider id to one that supports host capabilities. */
export function isHostCapabilityProvider(provider: string): provider is HostCapabilityProvider {
  return Object.hasOwn(hostWorkspaceGuideFiles, provider);
}

/** Checks whether a resolved path remains inside a resolved directory. */
function isPathWithin(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Finds the real path of the nearest existing ancestor of a requested path. */
function findRealExistingAncestor(target: string): string {
  let candidate = target;
  while (path.dirname(candidate) !== candidate) {
    try {
      return fs.realpathSync(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      candidate = path.dirname(candidate);
    }
  }
  return fs.realpathSync(candidate);
}

/** Resolves and creates one workspace without following a path outside its provider root. */
function resolveWorkingDirectory(options: HostToolAccessOptions): string {
  const base = path.resolve(options.workingDirectoryBase);
  const workingDirectory = path.resolve(base, options.workingDirId ?? 'default');
  if (!isPathWithin(base, workingDirectory)) {
    throw new Error(`Host tool working directory must remain under provider root: ${options.workingDirId ?? 'default'}.`);
  }

  fs.mkdirSync(base, { recursive: true });
  const realBase = fs.realpathSync(base);
  if (!isPathWithin(realBase, findRealExistingAncestor(workingDirectory))) {
    throw new Error(`Host tool working directory resolves outside provider root: ${options.workingDirId ?? 'default'}.`);
  }

  fs.mkdirSync(workingDirectory, { recursive: true });
  const realWorkingDirectory = fs.realpathSync(workingDirectory);
  if (!isPathWithin(realBase, realWorkingDirectory)) {
    throw new Error(`Host tool working directory resolves outside provider root: ${options.workingDirId ?? 'default'}.`);
  }
  return realWorkingDirectory;
}

/** Returns the default guide content for one provider-specific host workspace. */
function getHostWorkspaceGuide(provider: HostCapabilityProvider): string {
  const filename = hostWorkspaceGuideFiles[provider];
  return `# ${filename}
This is a shared workspace for agents serving the same civilization, persisting across turns. You will:

- Keep durable knowledge and dated turn snapshots in consistent folders, e.g., \`snapshots/\` or \`notes/\`.
  - Clearly distinguish observations, inferences, and plans. Current tools are the source of truth and override stale notes.
- With Write access, you may improve this guide and organize the workspace when useful.
  - Only put permenant instructions for all agents in this instruction file.
  - Do not copy untrusted third-party information into ${filename}. 
- While you have access to the workspace, the goal is to complete the ongoing task.

## Command execution

- Assume the working directory has correct filesystem access. Do not attempt to debug it.
- Use the tool's configured shell directly. Do not wrap commands in another shell (\`powershell.exe -Command\`, \`cmd /c\`, \`bash -lc\`).
- Prefer one simple operation per tool call. Split unrelated commands instead of chaining them with \`;\`, \`&&\`, \`||\`, pipelines, subshells, command substitution, or dynamically constructed command strings.
- If a command is declined or reports \`blocked by policy\`, it did not execute. Simplify it, remove nested shells and chaining, split it into direct commands, and retry only the safe in-scope parts.
`;
}

/**
 * Creates a provider-specific workspace guide once without overwriting agent
 * changes. Anything already at the guide path, including an agent's directory
 * or link, is left alone, and any other write failure is logged rather than
 * thrown: the guide is advisory, so it must never block the model call.
 */
export function seedHostWorkspaceGuide(access: HostToolAccess, provider: HostCapabilityProvider): void {
  if (!access.read || !access.workingDirectory) return;
  const guidePath = path.join(access.workingDirectory, hostWorkspaceGuideFiles[provider]);
  try {
    fs.writeFileSync(guidePath, getHostWorkspaceGuide(provider), {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    logger.warn(`Could not seed host workspace guide ${guidePath}: ${(error as Error).message}`);
  }
}

/** Normalizes the configured host meta-tools into provider-neutral capabilities. */
export function resolveHostToolCapabilities(requestedTools: readonly string[] | undefined): HostToolCapabilities {
  if (!requestedTools || requestedTools.length === 0) return { read: false, write: false, web: false };

  const everything = requestedTools.length === 1 && requestedTools[0] === everythingHostTools;
  if (!everything) {
    const unknown = requestedTools.filter((tool) => !(hostMetaTools as readonly string[]).includes(tool));
    if (unknown.length > 0) {
      throw new Error(`Unsupported hostTools entries: ${unknown.join(', ')}. Use ['${everythingHostTools}'] alone or any of: ${hostMetaTools.join(', ')}.`);
    }
  }

  const enabled = new Set<string>(everything ? hostMetaTools : requestedTools);
  const write = enabled.has('Write');
  return { read: write || enabled.has('Read'), write, web: enabled.has('Web') };
}

/**
 * Resolve a deny-by-default meta-tool request and create a working directory
 * only when an enabled capability needs one. Working-directory capabilities
 * default to Read, Write, and Web, so Claude Code preserves its Web-only cwd.
 * `['everything']` enables every meta-tool, `Write` implies `Read`, and any
 * other name fails fast so a stale concrete tool name cannot silently produce
 * a weaker or stronger policy.
 */
export function resolveHostToolAccess(
  requestedTools: readonly string[] | undefined,
  options: HostToolAccessOptions,
): HostToolAccess {
  const capabilities = resolveHostToolCapabilities(requestedTools);
  const workingDirectoryTools = options.workingDirectoryTools ?? hostMetaTools;
  const needsWorkingDirectory = (workingDirectoryTools.includes('Read') && capabilities.read)
    || (workingDirectoryTools.includes('Write') && capabilities.write)
    || (workingDirectoryTools.includes('Web') && capabilities.web);
  const workingDirectory = needsWorkingDirectory ? resolveWorkingDirectory(options) : undefined;
  return {
    ...capabilities,
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
  };
}
