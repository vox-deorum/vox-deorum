/**
 * Interleave deal messages into the conversation stream as inline "deal cards", the second
 * surface for a deal alongside the configuring dialog (interactive-diplomacy stage 4).
 *
 * This is a **UI-only** merge: deal cards are NOT added to `thread.messages` (which feeds the
 * diplomat's model context — see hydrateMessages, which keeps it to text/close). Instead the
 * view fetches deal messages via the `/deals` route, reduces them, and merges them with the
 * rendered text/close messages here, ordered by timestamp, so a proposal appears in the
 * conversation flow with Accept / Reject / Counter without leaking into the LLM transcript.
 */

import type { MessageWithMetadata, DealTranscriptMessage } from '@/utils/types';

/** A rendered thread item: an ordinary chat message, or (when `deal` is set) an inline deal card. */
export type RenderedThreadItem = MessageWithMetadata & { deal?: DealTranscriptMessage };

/**
 * Deal message types that render as a card in the conversation stream. A `deal-reject` is NOT
 * a card of its own — the rejection is rendered as the *status* of the proposal it answers
 * (see deal-reduce + DealMessageCard), so it never needs a standalone card here.
 */
const CARD_TYPES = new Set(['deal-proposal', 'deal-counter', 'deal-accept', 'deal-enacted']);

/**
 * Normalize a thread's message datetimes to real `Date` objects. Messages hydrated from the
 * server arrive with `metadata.datetime` as an ISO string (a `Date` serialized over HTTP),
 * while live-streamed messages already carry `Date` objects. Unify the two formats so the
 * loaded history "loads dates" and timestamp math (the sort below) sees one shape.
 */
export function reviveMessageDates(messages: MessageWithMetadata[]): MessageWithMetadata[] {
  return messages.map((m) =>
    m.metadata?.datetime instanceof Date
      ? m
      : { ...m, metadata: { ...m.metadata, datetime: new Date(m.metadata.datetime) } }
  );
}

/**
 * Merge rendered chat messages (text/close) with deal-message cards into one ordered list.
 * Cards are aligned like messages — the voiced (LLM) seat on the assistant side, everyone
 * else on the user side — and ordered with the chat messages by timestamp (stable on ties).
 *
 * @param messages    The already-visible text/close messages (from thread.messages).
 * @param dealMessages The conversation's deal messages (append order), from the `/deals` route.
 * @param voicedID    The agent-voiced seat's playerID (its messages align as assistant).
 */
export function mergeThreadItems(
  messages: MessageWithMetadata[],
  dealMessages: DealTranscriptMessage[],
  voicedID: number
): RenderedThreadItem[] {
  const items: RenderedThreadItem[] = messages.map((m) => ({ ...m }));

  for (const d of dealMessages) {
    if (!CARD_TYPES.has(d.MessageType)) continue;
    items.push({
      message: { role: d.SpeakerID === voicedID ? 'assistant' : 'user', content: '' },
      // DiplomaticMessages.CreatedAt is SQLite unixepoch() seconds, not milliseconds.
      metadata: { datetime: new Date(d.CreatedAt * 1000), turn: d.Turn },
      deal: d,
    });
  }

  // Decorate-sort by timestamp, keeping original order on ties (stable across engines).
  return items
    .map((item, index) => ({ item, index, time: item.metadata.datetime.getTime() }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map((x) => x.item);
}
