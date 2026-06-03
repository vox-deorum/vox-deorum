/**
 * @module strategist/pacing/utils
 *
 * Shared helpers for interruption strategies that inspect cached GameState data.
 */

import type { GameState } from "../strategy-parameters.js";

export interface EventRecord {
  Type?: unknown;
  OriginatingPlayerID?: unknown;
  TargetTeamID?: unknown;
}

/**
 * Return the player's team ID from a cached players report.
 *
 * get-players omits TeamID when a player is on their own default team, so the
 * player ID is the fallback team ID for that common case.
 */
export function getPlayerTeamID(players: GameState["players"], playerID: number): number | undefined {
  const player = players?.[String(playerID)];
  if (player && typeof player === "object") {
    const teamID = (player as Record<string, unknown>).TeamID;
    return typeof teamID === "number" ? teamID : playerID;
  }
  return undefined;
}

/**
 * Flatten supported event report shapes into a single event list.
 *
 * Current-turn cached events use `{ events: [...] }`, while merged decision
 * windows may be keyed by turn or report section. Interruption strategies only
 * need the event records, not the original grouping.
 */
export function flattenEvents(events: GameState["events"]): EventRecord[] {
  if (!events || typeof events !== "object") return [];

  if ("events" in events && Array.isArray((events as { events?: unknown }).events)) {
    return ((events as { events: unknown[] }).events)
      .filter(isEventRecord);
  }

  return Object.values(events as Record<string, unknown>)
    .flatMap(value => Array.isArray(value) ? value : [])
    .filter(isEventRecord);
}

/**
 * Narrow loose cached event values to object records.
 */
function isEventRecord(value: unknown): value is EventRecord {
  return value !== null && typeof value === "object";
}
