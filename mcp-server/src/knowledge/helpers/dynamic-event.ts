/**
 * Dynamic event utilities for creating non-game events in the GameEvents table.
 * Handles ID generation, player name enrichment, and storage via the existing storeGameEvent.
 */

import { Selectable } from 'kysely';
import { knowledgeManager } from '../../server.js';
import { readPublicKnowledgeBatch } from './cached.js';
import { getPlayerInformations } from '../getters/player-information.js';
import { PlayerInformation } from '../schema/public.js';

/** Offset within a turn's ID space where dynamic events begin */
const dynamicEventOffset = 900000;

/** In-memory counter for dynamic event IDs, resets per turn */
let dynamicEventCounter = 0;
let lastDynamicTurn = -1;

/**
 * Generate the next dynamic event ID for the given turn.
 * Uses an in-memory counter that resets when the turn changes.
 * IDs follow the pattern: turn * 1000000 + 900000 + counter
 */
export function nextDynamicEventId(turn: number): number {
  if (turn !== lastDynamicTurn) {
    dynamicEventCounter = 0;
    lastDynamicTurn = turn;
  }
  return turn * 1000000 + dynamicEventOffset + dynamicEventCounter++;
}

/**
 * Store a dynamic event in the GameEvents table via the existing storeGameEvent.
 * Generates a unique ID and delegates to storeGameEvent for enrichment and persistence.
 *
 * @param type - Event type string (e.g. "DiplomaticMessage")
 * @param payload - Enriched event payload
 * @param visibilityFlags - Player visibility array (use composeVisibility to create)
 * @returns The generated event ID
 */
export async function storeDynamicEvent(
  type: string,
  payload: Record<string, unknown>,
  visibilityFlags?: number[]
): Promise<number> {
  const turn = knowledgeManager.getTurn();
  const eventId = nextDynamicEventId(turn);
  const store = knowledgeManager.getStore();
  await store.storeGameEvent(eventId, type, payload, visibilityFlags);
  return eventId;
}

/**
 * Load player information map for name enrichment.
 * Uses the cached public knowledge batch reader.
 *
 * @returns Map from player ID to PlayerInformation
 */
export async function getPlayerMap(): Promise<Map<number, Selectable<PlayerInformation>>> {
  const players = await readPublicKnowledgeBatch(
    'PlayerInformations', getPlayerInformations
  ) as Selectable<PlayerInformation>[];

  const map = new Map<number, Selectable<PlayerInformation>>();
  for (const p of players) {
    map.set(p.Key, p);
  }
  return map;
}

/**
 * Resolve a player ID to a display name.
 * Major civs use Civilization name, minor civs use Leader name.
 * Matches the convention used in get-diplomatic-events.
 */
export function resolvePlayerName(
  playerMap: Map<number, Selectable<PlayerInformation>>,
  playerId: number
): string {
  const info = playerMap.get(playerId);
  if (!info) return `Player ${playerId}`;
  return info.IsMajor ? info.Civilization : info.Leader;
}
