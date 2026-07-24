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
  /** Read only rows with IDs lower than this exclusive cursor. */
  beforeID?: number;
  /** Maximum raw rows to scan before any speaker-role filter. */
  limit?: number;
}

/** One cursor-based transcript page with metadata based on the raw SQL scan. */
export interface DiplomaticMessagePage {
  messages: Selectable<DiplomaticMessage>[];
  hasMore: boolean;
  NextBeforeID?: number;
}

/**
 * Read the transcript between two endpoints as one ordered thread, optionally filtered.
 * The order is independent of the argument order: {A, B} and {B, A} read identically.
 *
 * @param playerAID One endpoint (may be the observer sentinel -1)
 * @param playerBID The other endpoint
 * @param filters Optional message-type / speaker-role filters
 * @returns A page whose messages are ordered by append ID
 */
/** Read a transcript as one page, retaining unbounded reads when no paging inputs are supplied. */
export async function getDiplomaticMessages(
  playerAID: number,
  playerBID: number,
  filters: DiplomaticMessageFilters = {}
): Promise<DiplomaticMessagePage> {
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

  const paged = filters.beforeID !== undefined || filters.limit !== undefined;
  if (!paged) {
    const rows = await query.orderBy('ID').execute();
    return {
      messages: filterSpeakerRole(rows, filters.speakerRole),
      hasMore: false,
    };
  }

  if (filters.beforeID !== undefined) {
    query = query.where('ID', '<', filters.beforeID);
  }

  const limit = filters.limit ?? 100;
  const rawRows = await query.orderBy('ID', 'desc').limit(limit + 1).execute();
  const scannedRows = rawRows.slice(0, limit);
  const nextBeforeID = scannedRows[scannedRows.length - 1]?.ID;
  const ascendingRows = [...scannedRows].reverse();

  return {
    messages: filterSpeakerRole(ascendingRows, filters.speakerRole),
    hasMore: rawRows.length > limit,
    NextBeforeID: nextBeforeID,
  };
}

/** Filter already ordered transcript rows by the free-form role of their speaker. */
function filterSpeakerRole(
  rows: Selectable<DiplomaticMessage>[],
  speakerRole: string | undefined
): Selectable<DiplomaticMessage>[] {
  if (speakerRole !== undefined) {
    return rows.filter(
      (message) => (message.SpeakerID === message.Player1ID ? message.Player1Role : message.Player2Role) === speakerRole
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
