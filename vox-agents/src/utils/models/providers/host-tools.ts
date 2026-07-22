/**
 * Shared host-tool policy for providers that can execute local capabilities.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Sentinel that requests a provider's explicitly vetted host-tool set. */
export const everythingHostTools = 'everything';

/** Identifies runtime-owned resources that providers may isolate by working directory. */
export interface ModelRuntimeIdentity {
  workingDirId?: string;
}

/** The resolved host-tool availability and optional isolated working directory. */
export interface HostToolPolicy {
  allowedTools: string[];
  workingDirectory?: string;
}

/** Provider-specific inputs used to resolve the shared host-tool policy. */
export interface HostToolPolicyOptions extends ModelRuntimeIdentity {
  everythingExpansion?: readonly string[];
  blockedTools: readonly string[];
  workingDirectoryNamespace: string;
}

/**
 * Resolve a deny-by-default host-tool policy and create a working directory only
 * when the resolved allowlist enables at least one tool.
 */
export function resolveHostToolPolicy(
  requestedTools: readonly string[] | undefined,
  options: HostToolPolicyOptions,
): HostToolPolicy {
  if (!requestedTools || requestedTools.length === 0) return { allowedTools: [] };

  const expandedTools = requestedTools.length === 1 && requestedTools[0] === everythingHostTools
    ? options.everythingExpansion ?? []
    : requestedTools;
  const blockedTools = new Set(options.blockedTools);
  const allowedTools = expandedTools.filter((tool) => !blockedTools.has(tool));

  if (allowedTools.length === 0) return { allowedTools };

  const workingDirectory = path.join(
    os.tmpdir(),
    options.workingDirectoryNamespace,
    options.workingDirId ?? 'default',
  );
  fs.mkdirSync(workingDirectory, { recursive: true });
  return { allowedTools, workingDirectory };
}
