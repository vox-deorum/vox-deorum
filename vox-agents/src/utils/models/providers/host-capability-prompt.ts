/**
 * Prompt guidance for providers with optional local or web capabilities.
 */

import type { LanguageModelV3Middleware } from '@ai-sdk/provider';
import { hostWorkspaceGuideFiles } from './host-tools.js';
import type { HostCapabilityProvider, HostToolCapabilities } from './host-tools.js';
import { appendSystemInstruction } from './system-prompt.js';

/** Heading that opens every host-capability reminder. */
export const hostCapabilityHeading = '# Extra Capabilities';

/** Format a natural-language list for the enabled capability names. */
function formatCapabilities(access: HostToolCapabilities): string {
  const names = [access.read ? 'Read' : undefined, access.write ? 'Write' : undefined, access.web ? 'Web' : undefined]
    .filter((name): name is string => name !== undefined);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * Build a brief, capability-aware reminder. It deliberately contains only
 * working guidance, leaving game-specific facts to the agent's assigned task
 * and current game context.
 */
export function hostCapabilityInstruction(
  provider: HostCapabilityProvider,
  access: HostToolCapabilities,
): string | undefined {
  if (!access.read && !access.write && !access.web) return undefined;

  const guide = hostWorkspaceGuideFiles[provider];
  const sentences = [
    `To support your core mission, optional capabilities are enabled for this call: ${formatCapabilities(access)}.`,
  ];

  if (access.read) {
    sentences.push(
      `Your working directory is a persistent per-civilization scratch workspace shared by all agents. Consult ${guide} for its working conventions.`,
    );
    sentences.push(access.write
      ? `Use the workspace to maintain notes and improve ${guide} when that supports the core mission.`
      : 'You can consult the workspace but cannot update it.');
  }

  if (access.web) sentences.push('You can search the web and fetch current online information.');
  return `${hostCapabilityHeading}\n${sentences.join(' ')}`;
}

/**
 * Add the host-capability reminder as an immutable outer middleware wrapper.
 */
export function hostCapabilityMiddleware(
  provider: HostCapabilityProvider,
  access: HostToolCapabilities,
): LanguageModelV3Middleware {
  const instruction = hostCapabilityInstruction(provider, access);
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => instruction === undefined
      ? params
      : { ...params, prompt: appendSystemInstruction(params.prompt, instruction) },
  };
}
