/**
 * @module strategist/pacing/utils
 *
 * Shared helpers for interruption strategies that inspect cached GameState data.
 */

import type { GameState } from "../strategy-parameters.js";

export interface EventRecord extends Record<string, unknown> {
  Type?: unknown;
  // Field names match the consolidated `get-events` shape, where `cleanEventData`
  // rewrites raw `XxxID` keys to `Xxx`. Player and team references are NOT bare
  // numbers in the consolidated form:
  //   - Player fields (`OriginatingPlayer`, `Player`) render as a `"<id>: <Civ>"`
  //     string when the player resolves, or a bare number when unresolved/empty.
  //   - Team fields (`TargetTeam`, `Team`) render as an object carrying an embedded
  //     `.ID` when team members resolve, or a bare number when the team object is empty.
  // Use `extractPlayerID`/`extractTeamID` to read them. `ToPlayerID`/`Importance`
  // survive consolidation unchanged (the resolved `ToPlayer` string sibling blocks
  // the `…ID` → `…` rename).
  ToPlayerID?: unknown;
  OriginatingPlayer?: unknown;
  TargetTeam?: unknown;
  Team?: unknown;
  Player?: unknown;
  ChangeAmount?: unknown;
  HasTech?: unknown;
  Importance?: unknown;
}

/**
 * Extract a numeric player ID from a consolidated player field. `cleanEventData`
 * renders these as either a `"<id>: <Civilization>"` string (resolved) or a bare
 * number (unresolved/empty player object).
 */
export function extractPlayerID(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const id = Number.parseInt(value, 10);
    return Number.isNaN(id) ? undefined : id;
  }
  return undefined;
}

/**
 * Extract a numeric team ID from a consolidated team field. `cleanEventData`
 * embeds the team ID into the resolved member object as `.ID`, or leaves a bare
 * number when the team object was empty.
 */
export function extractTeamID(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const id = (value as Record<string, unknown>).ID;
    return typeof id === "number" ? id : undefined;
  }
  return undefined;
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
