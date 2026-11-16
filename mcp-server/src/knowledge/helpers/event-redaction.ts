import type { Selectable } from 'kysely';
import type { PlayerSummary } from '../schema/timed.js';

/** Copy an event payload and replace resources absent from the supplied dated inventory. */
export function redactEventResources<T>(value: T, player: Pick<Selectable<PlayerSummary>, 'Resources'> | null): T {
  if (Array.isArray(value)) return value.map(item => redactEventResources(item, player)) as T;
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val && (key === 'ResourceType' || key === 'Resource')) {
      result[key] = player?.Resources && !Object.keys(player.Resources).includes(val as string) ? 'None' : val;
    } else {
      result[key] = redactEventResources(val, player);
    }
  }
  return result as T;
}
