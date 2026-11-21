/** Stable configuration serialization and independent deterministic editorial streams. */
import { createHash } from 'node:crypto';
import seedrandom from 'seedrandom';
import type { EditorialConfig } from '../config/schema.js';

/** Serialize configuration independent of object insertion order. */
export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Produce a stable compact identifier while retaining the complete snapshot in the decision. */
export function configurationHash(value: unknown): string {
  let hash = 2166136261;
  for (const character of stableSerialize(value))
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Draw a stable number in [0, 1) from the check identity, rule definition and subject identity. */
export function stableDraw(identitySeed: string, ruleId: string, subject: string): number {
  const digest = createHash('sha256').update(JSON.stringify([identitySeed, ruleId, subject])).digest();
  return digest.readUInt32BE(0) / 0x100000000;
}

/** Draw a design using only the identity of the current check. */
export function pressRunDesignDraw(checkId: string): number {
  return stableDraw(checkId, 'press-run-design', '');
}

/** Give each page an independent draw for the selected design. */
export function pressRunLayoutDraw(checkId: string, designId: string, pageId: string): number {
  return stableDraw(checkId, 'press-run-layout', JSON.stringify([designId, pageId]));
}

/** Bind independent streams only to the configuration sections that affect their choices. */
export function createEditorialStreams(
  identitySeed: string,
  config: EditorialConfig
): { prose: () => number; presentation: () => number } {
  return {
    prose: seedrandom(
      `${identitySeed}/prose/${configurationHash({ templates: config.templates, triggers: config.triggers })}`
    ),
    presentation: seedrandom(
      `${identitySeed}/presentation/${configurationHash({ designs: config.designs, pages: config.pages })}`
    ),
  };
}
