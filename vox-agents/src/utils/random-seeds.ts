import type { RandomSeedsConfig } from '../types/config.js';

const UINT32_MAX = 0xffffffff;

/**
 * Parse one side of `--seed <sync>:<map>`.
 *
 * Civ stores both seed values as unsigned 32-bit integers. We reject `0` here
 * because `0` is Civ's sentinel for "choose a default/random seed", not a fixed
 * experiment seed.
 */
export function parseSeedValue(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} seed must be a positive integer`);
  }

  const parsed = Number(value);
  validateSeedValue(parsed, label);
  return parsed;
}

/**
 * Validate a configured fixed seed value.
 *
 * Omitted seeds are allowed at the object level, but any present seed must be a
 * real fixed seed rather than Civ's `0` default sentinel.
 */
export function validateSeedValue(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0 || value > UINT32_MAX) {
    throw new Error(`${label} seed must be a positive uint32 integer`);
  }
}

/**
 * Normalize and validate optional config-file seed settings.
 *
 * Returning `undefined` for an empty object keeps downstream checks simple:
 * "no randomSeeds" and "randomSeeds: {}" behave the same.
 */
export function validateRandomSeeds(seeds?: RandomSeedsConfig): RandomSeedsConfig | undefined {
  if (!seeds) return undefined;

  const normalized: RandomSeedsConfig = {};
  if (seeds.sync !== undefined) {
    validateSeedValue(seeds.sync, 'sync');
    normalized.sync = seeds.sync;
  }
  if (seeds.map !== undefined) {
    validateSeedValue(seeds.map, 'map');
    normalized.map = seeds.map;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Parse the compact CLI form `--seed <sync>:<map>`.
 *
 * Either side may be empty so users can override just one seed:
 * `123:` fixes SyncRandSeed only, while `:456` fixes MapRandSeed only.
 */
export function parseSeedArgument(value: string): RandomSeedsConfig {
  const parts = value.split(':');
  if (parts.length !== 2) {
    throw new Error('Seed argument must use the form <sync>:<map>');
  }

  const [syncRaw, mapRaw] = parts;
  if (syncRaw === '' && mapRaw === '') {
    throw new Error('Seed argument must include at least one seed');
  }

  const seeds: RandomSeedsConfig = {};
  if (syncRaw !== '') seeds.sync = parseSeedValue(syncRaw, 'sync');
  if (mapRaw !== '') seeds.map = parseSeedValue(mapRaw, 'map');
  return seeds;
}

/**
 * Apply CLI seed overrides per field, preserving the config-file value for any
 * seed the CLI did not mention.
 */
export function mergeRandomSeeds(
  base?: RandomSeedsConfig,
  override?: RandomSeedsConfig
): RandomSeedsConfig | undefined {
  return validateRandomSeeds({
    ...(base ?? {}),
    ...(override ?? {})
  });
}

/** True when at least one seed is explicitly fixed. */
export function hasRandomSeeds(seeds?: RandomSeedsConfig): boolean {
  return seeds?.sync !== undefined || seeds?.map !== undefined;
}
