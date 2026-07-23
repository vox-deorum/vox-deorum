/**
 * Shared host meta-tool policy for providers that can execute local capabilities.
 */

import fs from 'node:fs';
import path from 'node:path';
import { everythingHostTools, hostMetaTools } from '../../../types/config.js';
import type { HostMetaTool } from '../../../types/config.js';

export { everythingHostTools, hostMetaTools } from '../../../types/config.js';
export type { HostMetaTool } from '../../../types/config.js';

/** Identifies runtime-owned resources that providers may isolate by working directory. */
export interface ModelRuntimeIdentity {
  workingDirId?: string;
}

/** The resolved capability set and the isolated working directory backing it. */
export interface HostToolAccess {
  read: boolean;
  write: boolean;
  web: boolean;
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
  const workingDirectoryTools = options.workingDirectoryTools ?? hostMetaTools;
  const needsWorkingDirectory = workingDirectoryTools.some((tool) => enabled.has(tool));
  const workingDirectory = needsWorkingDirectory
    ? path.join(options.workingDirectoryBase, options.workingDirId ?? 'default')
    : undefined;
  if (workingDirectory) fs.mkdirSync(workingDirectory, { recursive: true });
  return {
    read: write || enabled.has('Read'),
    write,
    web: enabled.has('Web'),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
  };
}
