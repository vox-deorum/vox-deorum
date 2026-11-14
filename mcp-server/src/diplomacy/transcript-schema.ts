/**
 * Canonical wire contract for a durable diplomatic-conversation transcript message.
 *
 * This is the single source of truth for the **projected, plain-data** shape that the
 * `read-transcript` tool returns and the `append-message` tool writes — distinct from the
 * Kysely `DiplomaticMessage` table type (knowledge/schema/timed.ts), which carries
 * `Generated<>` / `JSONColumnType<>` wrappers and the per-player `Player0..21` visibility
 * columns that never cross the wire. Consumers (the mcp-server tools and vox-agents, which
 * imports the compiled `dist/`) share these definitions instead of re-declaring the row
 * shape and the message vocabulary.
 */

import * as z from "zod";

/** Full message vocabulary (matches the DiplomaticMessages schema column). */
export const MESSAGE_TYPES = [
  "text",
  "close",
  "deal-proposal",
  "deal-counter",
  "deal-accept",
  "deal-reject",
  "deal-enacted",
] as const;

/** One message-type literal from the shared vocabulary. */
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Schema for a single transcript message row as returned by `read-transcript`. */
export const TranscriptMessageSchema = z.object({
  ID: z.number(),
  Player1ID: z.number(),
  Player2ID: z.number(),
  Player1Role: z.string(),
  Player2Role: z.string(),
  SpeakerID: z.number(),
  // The store only ever writes one of MESSAGE_TYPES, so type the wire row to the vocabulary.
  MessageType: z.enum(MESSAGE_TYPES),
  Content: z.string(),
  Payload: z.record(z.string(), z.any()),
  Turn: z.number(),
  CreatedAt: z.number(),
});

/** The projected wire shape of one transcript message (no DB/visibility columns). */
export type TranscriptMessage = z.infer<typeof TranscriptMessageSchema>;

/**
 * Build the row-projection schema a deal action returns for the durable row it just wrote
 * (or found already written), narrowed to that action's single message type.
 *
 * The deal writers (`enact-agent-deal`, `reject-agent-deal`) hand their caller the exact
 * committed rows so the caller never has to reread the transcript to learn what it created
 * (stage 7.04 work item 2). Reusing `TranscriptMessageSchema` here — rather than each tool
 * re-declaring the eleven fields — keeps those returned rows structurally assignable to the
 * ordinary `TranscriptMessage` a transcript read produces, so a consumer can merge them into
 * a live transcript cache without a second projection step.
 *
 * @param messageType - The single message type rows of this shape always carry
 * @returns A `TranscriptMessageSchema` whose `MessageType` is pinned to that literal
 */
export const transcriptRowSchemaFor = <T extends MessageType>(messageType: T) =>
  TranscriptMessageSchema.extend({ MessageType: z.literal(messageType) });
