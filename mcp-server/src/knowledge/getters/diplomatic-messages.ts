/**
 * Getters for the durable diplomatic conversation transcript.
 *
 * A conversation is keyed by the ordered player pair (Player1ID = min, Player2ID = max,
 * with the observer sentinel -1 sorting to Player1ID). The conversation *is* the
 * append-ID-ordered list of DiplomaticMessages rows — there is no thread table and
 * no status column, so reads simply filter by the pair and order by ID.
 */

import { Selectable } from 'kysely';
import { DiplomaticMessage } from '../schema/timed.js';
import { knowledgeManager } from '../../server.js';

/**
 * Order two endpoint IDs into the canonical (Player1ID, Player2ID) pair.
 * Player1ID is the smaller value, so the observer sentinel (-1) always sorts first.
 */
export function orderPlayerPair(playerAID: number, playerBID: number): { player1ID: number; player2ID: number } {
  return {
    player1ID: Math.min(playerAID, playerBID),
    player2ID: Math.max(playerAID, playerBID),
  };
}

/**
 * Optional filters for narrowing a transcript read.
 */
export interface DiplomaticMessageFilters {
  /** Only messages of this type (e.g. 'deal-proposal'). */
  messageType?: string;
  /** Only messages whose speaking endpoint holds this role (free-form descriptor). */
  speakerRole?: string;
}

/**
 * Read the transcript between two endpoints as one ordered thread, optionally filtered.
 * The order is independent of the argument order: {A, B} and {B, A} read identically.
 *
 * @param playerAID One endpoint (may be the observer sentinel -1)
 * @param playerBID The other endpoint
 * @param filters Optional message-type / speaker-role filters
 * @returns Matching messages between the pair, ordered by append ID
 */
export async function getDiplomaticMessages(
  playerAID: number,
  playerBID: number,
  filters: DiplomaticMessageFilters = {}
): Promise<Selectable<DiplomaticMessage>[]> {
  const db = knowledgeManager.getStore().getDatabase();
  const { player1ID, player2ID } = orderPlayerPair(playerAID, playerBID);

  let query = db
    .selectFrom('DiplomaticMessages')
    .selectAll()
    .where('Player1ID', '=', player1ID)
    .where('Player2ID', '=', player2ID);

  // MessageType is a column, so push it down to SQL.
  if (filters.messageType !== undefined) {
    query = query.where('MessageType', '=', filters.messageType);
  }

  const rows = await query.orderBy('ID').execute();

  // The speaker's role is whichever ordered role matches SpeakerID; filter in JS
  // (transcripts are bounded) since it is a per-row derived value, not a column.
  if (filters.speakerRole !== undefined) {
    return rows.filter(
      (m) => (m.SpeakerID === m.Player1ID ? m.Player1Role : m.Player2Role) === filters.speakerRole
    );
  }

  return rows;
}

/**
 * Look up a single transcript message by its append ID.
 * Used to validate that an accept/reject references an earlier proposal/counter
 * in the same conversation.
 *
 * @param id The append ID of the message
 * @returns The message, or undefined if not found
 */
export async function getDiplomaticMessageById(
  id: number
): Promise<Selectable<DiplomaticMessage> | undefined> {
  const db = knowledgeManager.getStore().getDatabase();

  return await db
    .selectFrom('DiplomaticMessages')
    .selectAll()
    .where('ID', '=', id)
    .executeTakeFirst();
}
