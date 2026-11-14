/**
 * Shared host meta-tool policy for providers that execute their own
 * capabilities during a model run. File access does not live here: every
 * provider gets it from the seat `files` setting through the `bash` tool.
 */

import { hostMetaTools } from '../../../types/config.js';

export { hostMetaTools } from '../../../types/config.js';
export type { HostMetaTool } from '../../../types/config.js';

/** The normalized host capabilities a provider can execute itself. */
export interface HostToolCapabilities {
  web: boolean;
}

/** Providers that execute their own capabilities during a model run. */
const hostCapabilityProviders = new Set(['codex', 'claude-code']);

/** A provider whose configured host tools are available during model execution. */
export type HostCapabilityProvider = 'codex' | 'claude-code';

/** Narrows a configured provider id to one that supports host capabilities. */
export function isHostCapabilityProvider(provider: string): provider is HostCapabilityProvider {
  return hostCapabilityProviders.has(provider);
}

/** Normalizes the configured host meta-tools into provider-neutral capabilities. */
export function resolveHostToolCapabilities(requestedTools: readonly string[] | undefined): HostToolCapabilities {
  if (!requestedTools || requestedTools.length === 0) return { web: false };

  const unknown = requestedTools.filter((tool) => !(hostMetaTools as readonly string[]).includes(tool));
  if (unknown.length > 0) {
    throw new Error(`Unsupported hostTools entries: ${unknown.join(', ')}. Use any of: ${hostMetaTools.join(', ')}.`);
  }

  return { web: requestedTools.includes('Web') };
}
