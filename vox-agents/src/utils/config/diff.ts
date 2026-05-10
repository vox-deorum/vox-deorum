/**
 * @module utils/config/diff
 *
 * Compute and apply minimal diffs between a `VoxAgentsConfig` and the
 * shipped defaults. Used by the web UI's config editor (read the diff,
 * persist only what differs) and by `loadVoxConfig` (apply a stored diff
 * on top of defaults at startup).
 */

import type { VoxAgentsConfig, LLMConfig } from '../../types/index.js';

/**
 * Recursive deep equality check for plain JSON values
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => key in bObj && deepEqual(aObj[key], bObj[key]));
}

/**
 * Strip the `id` field from an LLM config value (UI adds it, defaults don't have it)
 */
function stripLLMId(val: string | LLMConfig | null): string | Omit<LLMConfig, 'id'> | null {
  if (typeof val !== 'object' || val === null) return val;
  const { id, ...rest } = val;
  return rest;
}

/**
 * Compute the minimal diff between a full config and defaults.
 * Only entries that differ from defaults are included.
 * For llms, deleted default entries are marked with null.
 */
export function computeConfigDiff(
  fullConfig: VoxAgentsConfig,
  defaults: VoxAgentsConfig
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};

  // Compare simple top-level fields (skip versionInfo - runtime only)
  const topLevelKeys: (keyof VoxAgentsConfig)[] = ['agent', 'webui', 'mcpServer', 'logging', 'configsDir', 'episodeDbPath', 'telemetryDir', 'obs'];
  for (const key of topLevelKeys) {
    if (!deepEqual(fullConfig[key], defaults[key])) {
      diff[key] = fullConfig[key];
    }
  }

  // Entry-level diff for llms
  const llmsDiff: Record<string, string | LLMConfig | null> = {};

  // Find modified/added entries
  for (const [key, value] of Object.entries(fullConfig.llms)) {
    const defaultValue = defaults.llms[key];
    if (defaultValue === undefined) {
      // User-added entry
      llmsDiff[key] = stripLLMId(value) as string | LLMConfig;
    } else if (!deepEqual(stripLLMId(value), stripLLMId(defaultValue))) {
      // Modified entry
      llmsDiff[key] = stripLLMId(value) as string | LLMConfig;
    }
  }

  // Find deleted default entries
  for (const key of Object.keys(defaults.llms)) {
    if (!(key in fullConfig.llms)) {
      llmsDiff[key] = null;
    }
  }

  if (Object.keys(llmsDiff).length > 0) {
    diff.llms = llmsDiff;
  }

  return diff;
}

/**
 * Reconstruct a full config by merging a diff file with defaults.
 * Handles null sentinels in llms as deletions.
 */
export function mergeConfigWithDefaults(
  fileConfig: Record<string, unknown>,
  defaults: VoxAgentsConfig
): VoxAgentsConfig {
  // Start with a shallow clone of defaults, deep clone llms separately
  const result: VoxAgentsConfig = {
    ...defaults,
    llms: { ...defaults.llms }
  };

  // Override top-level fields from file (skip llms, handled separately)
  const topLevelKeys: (keyof VoxAgentsConfig)[] = ['agent', 'webui', 'mcpServer', 'logging', 'configsDir', 'episodeDbPath', 'telemetryDir', 'obs'];
  for (const key of topLevelKeys) {
    if (key in fileConfig) {
      (result as any)[key] = fileConfig[key];
    }
  }

  // Merge llms with null-deletion support
  if (fileConfig.llms && typeof fileConfig.llms === 'object') {
    const fileLlms = fileConfig.llms as Record<string, string | LLMConfig | null>;
    for (const [key, value] of Object.entries(fileLlms)) {
      if (value === null) {
        delete result.llms[key];
      } else {
        result.llms[key] = value;
      }
    }
  }

  return result;
}
