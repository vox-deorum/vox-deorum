/**
 * @module web/chat/enrichment
 *
 * Resolves live session details and stable participant identities for Web chat responses.
 */

import { contextRegistry } from '../../infra/context-registry.js';
import { sessionRegistry } from '../../infra/session-registry.js';
import type { VoxContext } from '../../infra/vox-context.js';
import { StrategistSession } from '../../strategist/strategist-session.js';
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
import { reconcileDealRows } from '../../utils/diplomacy/deal.js';
import { audienceID, identityOf } from '../../utils/diplomacy/transcript.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('webui:enrichment');

/** Resolve the active strategist session's per-seat agent assignments, if available. */
export function getActiveAssignments(): Record<number, PlayerAssignment> | undefined {
  const session = sessionRegistry.getActive();
  return session instanceof StrategistSession ? session.getPlayerAssignments() : undefined;
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

/** Mirror committed deal rows into the cache without turning a refresh failure into a write failure. */
export async function mirrorDealRowsBestEffort(thread: EnvoyThread): Promise<void> {
  try {
    await reconcileDealRows(thread);
  } catch (error) {
    logger.error('Failed to mirror deal rows into the live cache after a committed write', { error });
  }
}

/** Resolve the authoritative turn from a live session or a sessionless context's base parameters. */
export function currentTurnOf(
  context: VoxContext<StrategistParameters> | undefined,
): number | undefined {
  return context?.session ? context.session.getTurn() : context?.getBaseParameters()?.turn;
}
