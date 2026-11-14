/**
 * @module web/chat/enrichment
 *
 * Resolves live session details and stable participant identities for Web chat responses.
 */

import { contextRegistry } from '../../agents/runtime/context-registry.js';
import { sessionRegistry } from '../../agents/runtime/session-registry.js';
import type { VoxContext } from '../../agents/runtime/vox-context.js';
import {
  getRecentGameState,
  type StrategistParameters,
} from '../../strategist/strategy-parameters.js';
import type {
  ChatResponseEnrichment,
  EnvoyThread,
  ParticipantIdentity,
  PlayerAssignment,
} from '../../types/index.js';
import { currentTurnOf } from '../../diplomacy/turn/live-turn.js';
import { audienceID, identityOf } from '../../diplomacy/transcript/transcript.js';

// The live-turn resolver now lives beside the shared conversation guard that consumes it
// (`diplomacy/turn/live-turn.ts`), so the chat turn runner and the deal actions cannot drift from
// the Web enrichment view of "what turn is it?". Re-exported here for the Web's existing importers.
export { currentTurnOf };

/** Resolve the active strategist session's per-seat agent assignments, if available. */
export function getActiveAssignments(): Record<number, PlayerAssignment> | undefined {
  return sessionRegistry.getActive()?.getPlayerAssignments();
}

/** Resolve the seat assigned to the human strategist, if one exists. */
export function resolveHumanSeat(assignments?: Record<number, PlayerAssignment>): number | undefined {
  if (!assignments) return undefined;
  for (const [id, assignment] of Object.entries(assignments)) {
    if (assignment.strategist === 'human-strategist') return parseInt(id);
  }
  return undefined;
}

/** Resolve a player's civilization and leader from the latest eligible live game state. */
export function civIdentity(
  context: VoxContext<StrategistParameters> | undefined,
  playerID: number,
): ParticipantIdentity | undefined {
  const parameters = context?.getBaseParameters();
  if (!parameters || playerID < 0 || !parameters.gameStates) return undefined;

  const ceiling = currentTurnOf(context) ?? Number.MAX_SAFE_INTEGER;
  const data = getRecentGameState(parameters, ceiling)?.players?.[playerID.toString()];
  if (typeof data !== 'object' || data === null) return undefined;

  const civilization = (data as Record<string, unknown>).Civilization;
  const leader = (data as Record<string, unknown>).Leader;
  if (typeof civilization !== 'string') return undefined;

  return {
    name: civilization,
    leader: typeof leader === 'string' ? leader : '',
  };
}

/**
 * Fill any missing seat identity on a diplomacy thread from the seat context's cached game state.
 *
 * Identities are snapshotted onto the thread at open time, but a thread opened before the voiced
 * seat's first `ensureGameState` (fresh launch, load, crash recovery) freezes `undefined` for both
 * seats. The chat turn runner calls this right after it has ensured the game state, so the same
 * turn that would otherwise run without identities repairs the thread with a pure cache read.
 * Already-present identities are never overwritten.
 */
export function backfillThreadIdentities(
  thread: EnvoyThread,
  context: VoxContext<StrategistParameters> | undefined,
): void {
  if (!thread.player1Identity) thread.player1Identity = civIdentity(context, thread.player1ID);
  if (!thread.player2Identity) thread.player2Identity = civIdentity(context, thread.player2ID);
}

/** Format a participant identity for display. */
export function displayIdentity(identity: ParticipantIdentity | undefined): string | undefined {
  if (!identity) return undefined;
  return identity.leader ? `${identity.leader} of ${identity.name}` : identity.name;
}

/** Build current-turn and participant display enrichment for a chat response. */
export function enrichChat(thread: EnvoyThread): ChatResponseEnrichment {
  const context = contextRegistry.get<StrategistParameters>(thread.contextId);
  return {
    currentTurn: currentTurnOf(context),
    voicedID: thread.agent,
    voicedCiv: displayIdentity(identityOf(thread, thread.agent)),
    audienceCiv: displayIdentity(identityOf(thread, audienceID(thread))),
  };
}
