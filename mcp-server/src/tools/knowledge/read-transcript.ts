/**
 * Tool for reading a durable diplomatic conversation transcript.
 *
 * Takes two endpoints, derives the canonical ordered player pair (Player1ID = min,
 * Player2ID = max, with the observer sentinel -1 sorting to Player1ID), and returns
 * every message between the pair ordered by append ID. Because there is exactly one
 * conversation per pair, A→B and B→A read as a single thread regardless of argument
 * order. The query filters by the player pair rather than by a single speaker's
 * visibility.
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { getDiplomaticMessages } from "../../knowledge/getters/diplomatic-messages.js";
import { MESSAGE_TYPES, type MessageType, TranscriptMessageSchema } from "../../utils/transcript-schema.js";

/** Input schema for the read-transcript tool. */
const ReadTranscriptInputSchema = z.object({
  PlayerAID: z.number().int().min(-1).describe("One endpoint's playerID (or -1 for the observer)"),
  PlayerBID: z.number().int().min(-1).describe("The other endpoint's playerID (or -1 for the observer)"),
  MessageType: z.enum(MESSAGE_TYPES).optional().describe("Optional: only return messages of this type"),
  Role: z.string().optional().describe("Optional: only return messages whose speaker holds this free-form role (e.g. 'diplomat')"),
  BeforeID: z.number().int().positive().optional().describe("Optional: exclusive cursor for an older transcript page"),
  Limit: z.number().int().positive().optional().describe("Optional: maximum raw transcript rows to scan in a page"),
});

/** Output schema: the ordered list of messages, wrapped in an object so the MCP
 * `structuredContent` is a record (the SDK rejects a root-level array). */
const ReadTranscriptOutputSchema = z.object({
  messages: z.array(TranscriptMessageSchema),
  hasMore: z.boolean().optional(),
  NextBeforeID: z.number().optional(),
});

/**
 * Tool that reads the ordered transcript between two players.
 */
class ReadTranscriptTool extends ToolBase {
  readonly name = "read-transcript";

  readonly description = "Read the durable conversation between two players (ordered by playerID) as one append-ID-ordered thread.";

  readonly inputSchema = ReadTranscriptInputSchema;

  readonly outputSchema = ReadTranscriptOutputSchema;

  readonly annotations: ToolAnnotations = { readOnlyHint: true };

  readonly metadata = {
    autoComplete: ["PlayerAID", "PlayerBID", "MessageType", "Role", "BeforeID", "Limit"],
  };

  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const page = await getDiplomaticMessages(args.PlayerAID, args.PlayerBID, {
      messageType: args.MessageType,
      speakerRole: args.Role,
      beforeID: args.BeforeID,
      limit: args.Limit,
    });

    // Project to the public message shape, dropping per-player visibility columns.
    return {
      messages: page.messages.map((m) => ({
        ID: m.ID,
        Player1ID: m.Player1ID,
        Player2ID: m.Player2ID,
        Player1Role: m.Player1Role,
        Player2Role: m.Player2Role,
        SpeakerID: m.SpeakerID,
        // The DB column is a free string; the store only ever writes a known type.
        MessageType: m.MessageType as MessageType,
        Content: m.Content,
        Payload: (m.Payload ?? {}) as Record<string, unknown>,
        Turn: m.Turn,
        CreatedAt: m.CreatedAt,
      })),
      hasMore: page.hasMore,
      NextBeforeID: page.NextBeforeID,
    };
  }
}

/**
 * Creates a new instance of the read-transcript tool.
 */
export default function createReadTranscriptTool() {
  return new ReadTranscriptTool();
}
