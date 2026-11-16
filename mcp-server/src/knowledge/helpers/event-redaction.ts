import type { Selectable } from 'kysely';
import type { PlayerSummary } from '../schema/timed.js';

/**
 * Copy an event payload and replace resources the player has not revealed.
 * The dated inventory lists only revealed strategic and luxury resources, so a resource is hidden when it
 * belongs to one of those tracked classes and is missing from the inventory. Other resources, such as bonus
 * resources, stay readable. Without a tracked list, any resource missing from the inventory is hidden.
 */
export function redactEventResources<T>(
  value: T,
  player: Pick<Selectable<PlayerSummary>, 'Resources'> | null,
  trackedResources?: ReadonlySet<string>
): T {
  if (Array.isArray(value)) return value.map(item => redactEventResources(item, player, trackedResources)) as T;
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val && (key === 'ResourceType' || key === 'Resource')) {
      result[key] = player?.Resources && isHiddenResource(val, player.Resources, trackedResources) ? 'None' : val;
    } else {
      result[key] = redactEventResources(val, player, trackedResources);
    }
  }
  return result as T;
}

/** Decide whether one stored resource value is outside what the dated inventory shows the player. */
function isHiddenResource(value: unknown, inventory: Record<string, unknown>, trackedResources?: ReadonlySet<string>): boolean {
  // Unmapped numeric IDs cannot be checked against the named inventory, so they stay hidden.
  if (typeof value !== 'string') return true;
  if (Object.hasOwn(inventory, value)) return false;
  return trackedResources ? trackedResources.has(value) : true;
}
