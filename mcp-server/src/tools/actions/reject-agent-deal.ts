/**
 * Tool that transactionally rejects (or retracts) an open agent deal proposal.
 *
 * This is the rejection route: the sole writer of the `deal-reject` transcript record (the
 * public `append-message` tool refuses it, a pinned writer-split alongside `deal-accept` /
 * `deal-enacted`). It sits beside `enact-agent-deal` so BOTH terminal answers to a proposal
 * are decided by one serialized read/check/write against the store rather than by a caller's
 * racy read-then-write: two clients racing to reject the same proposal, or racing a rejection
 * against an acceptance, can no longer both win.
 *
 * Either endpoint may speak the rejection: the counterparty *declines* the offer, or the
 * original proposer *retracts* their own offer (there is no separate `deal-retract` type).
 *
 * Idempotency: the proposal's existing `deal-reject` is the idempotency key. The same speaker
 * repeating their own rejection gets that stored row back with `AlreadyRejected: true` and no
 * second row is ever appended — a proposal carries at most ONE terminal rejection.
 *
 * Failure split: a lost race over proposal state (already rejected by the other endpoint,
 * already answered by an acceptance/enactment, superseded by a newer proposal, or a proposal
 * that never existed / is not a proposal at all) is a structured `conflict` result, so the
 * caller can map it to a 409-class outcome without parsing message text. A caller *bug*
 * (wrong conversation pair, speaker who is not an endpoint) and any infrastructure/DB failure
 * still throw through the MCP error channel.
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { knowledgeManager } from "../../server.js";
import { orderPlayerPair } from "../../knowledge/getters/diplomatic-messages.js";
import { transcriptRowSchemaFor } from "../../diplomacy/transcript-schema.js";
import { assertExpectedGame } from "../../utils/expected-game.js";
import {
  answeredProposalID,
  buildDealOutcomeRow,
  findAnswer,
  isCurrentProposal,
  loadProposalConversation,
  projectStoredDealRow,
  RESPONSE_TYPES,
} from "../../diplomacy/deals/deal-outcome.js";

/** The observer / no-seat endpoint sentinel (shared with append-message). */
const OBSERVER_ID = -1;

/**
 * The terminal responses that count as "already answered" HERE: every closing type except
 * `deal-reject`, which this tool classifies itself one step earlier (as its own idempotent path or
 * as `rejected-by-other`, depending on who spoke it).
 */
const ACCEPTING_TYPES: ReadonlySet<string> = new Set(
  [...RESPONSE_TYPES].filter((type) => type !== "deal-reject")
);

/** Outward line recorded when the caller supplies none. */
const DEFAULT_REJECT_CONTENT = "The deal was rejected.";

/** Input schema for the reject-agent-deal tool. */
const RejectAgentDealInputSchema = z.object({
  PlayerAID: z
    .number()
    .int()
    .min(OBSERVER_ID)
    .describe("One expected conversation endpoint's playerID (or -1 for the observer); order does not matter"),
  PlayerBID: z
    .number()
    .int()
    .min(OBSERVER_ID)
    .describe("The other expected conversation endpoint's playerID (or -1 for the observer); order does not matter"),
  ProposalMessageID: z
    .number()
    .int()
    .describe("Append ID of the deal-proposal / deal-counter being rejected"),
  SpeakerID: z
    .number()
    .int()
    .min(OBSERVER_ID)
    .describe("The endpoint speaking the rejection (must be one of the two endpoints; the proposal's author retracts)"),
  Content: z
    .string()
    .optional()
    .describe(`Optional outward line recorded with the rejection. Defaults to "${DEFAULT_REJECT_CONTENT}".`),
  ExpectedGameID: z
    .string()
    .min(1)
    .optional()
    .describe("Optional game identity guard. Rejects the call when the active game has switched."),
});

/** The durable `deal-reject` row this tool returns for either successful outcome. */
const RejectRowSchema = transcriptRowSchemaFor("deal-reject");

/**
 * Output schema: a discriminated result over the three possible outcomes.
 *
 * `Row` is present for BOTH `rejected` (the row this call inserted) and `already-rejected`
 * (the row a prior call inserted), and absent for `conflict`; `ConflictReason` /
 * `ConflictMessage` are present only for `conflict`.
 */
const RejectAgentDealOutputSchema = z.object({
  Result: z
    .enum(["rejected", "already-rejected", "conflict"])
    .describe("rejected = this call wrote the row; already-rejected = the same speaker had already rejected it; conflict = proposal state refused the rejection"),
  ProposalMessageID: z.number(),
  AlreadyRejected: z
    .boolean()
    .describe("True only on the already-rejected idempotent path (no new writes)"),
  Row: RejectRowSchema.optional().describe(
    "The durable deal-reject row (newly written, or the existing one when already rejected). Absent on a conflict."
  ),
  ConflictReason: z
    .enum(["not-found", "not-a-proposal", "superseded", "rejected-by-other", "answered"])
    .optional()
    .describe("Machine-readable conflict cause (present only when Result is conflict)"),
  ConflictMessage: z
    .string()
    .optional()
    .describe("Human-readable explanation of the conflict (present only when Result is conflict)"),
});

/**
 * Tool that records a proposal's rejection/retraction in one serialized store transaction,
 * enforcing at-most-one terminal rejection per proposal.
 */
class RejectAgentDealTool extends ToolBase {
  readonly name = "reject-agent-deal";

  readonly description =
    "Reject (or retract) an open agent deal proposal by message ID and record the deal-reject in the transcript, transactionally. Idempotent: the same speaker repeating their rejection returns the existing row without writing another. Returns a structured conflict when the proposal was already answered, already rejected by the other endpoint, or superseded.";

  readonly inputSchema = RejectAgentDealInputSchema;

  readonly outputSchema = RejectAgentDealOutputSchema;

  // Not read-only: it writes a transcript record.
  readonly annotations: ToolAnnotations = { readOnlyHint: false };

  readonly metadata = {
    autoComplete: ["PlayerAID", "PlayerBID", "SpeakerID"],
  };

  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const { PlayerAID, PlayerBID, ProposalMessageID, SpeakerID, Content, ExpectedGameID } = args;
    assertExpectedGame(this.name, ExpectedGameID);

    if (PlayerAID === PlayerBID) {
      throw new Error("The two conversation endpoints must be distinct");
    }

    // Order the expected pair exactly as append-message does (Player1ID = min, so the observer
    // sentinel -1 sorts to Player1ID) so the stored proposal's columns can be compared directly.
    const { player1ID, player2ID } = orderPlayerPair(PlayerAID, PlayerBID);

    const store = knowledgeManager.getStore();
    const turn = knowledgeManager.getTurn();
    const content = Content?.trim() || DEFAULT_REJECT_CONTENT;

    /** Assemble one structured conflict result (no row, no write). */
    const conflict = (
      Reason: z.infer<typeof this.outputSchema>["ConflictReason"],
      Message: string
    ): z.infer<typeof this.outputSchema> => ({
      Result: "conflict" as const,
      ProposalMessageID,
      AlreadyRejected: false,
      ConflictReason: Reason,
      ConflictMessage: Message,
    });

    // Serialize the read/check/write sequence with all other store writes, exactly as
    // enact-agent-deal does. That makes the "is this proposal still open?" check authoritative:
    // no concurrent accept, enactment, counter, or second rejection can land between the check
    // and the insert.
    return store.runWriteTransaction(async (transaction) => {
      const loaded = await loadProposalConversation(transaction, ProposalMessageID);
      if (!loaded.ok) {
        // Both load failures are conflicts here (unlike enactment, which throws on them): a panel
        // rejecting a card it can still see has simply lost the race against a game reload or a
        // conversation it no longer shares.
        return loaded.failure === "not-found"
          ? conflict("not-found", `Proposal message ${ProposalMessageID} does not exist`)
          : conflict("not-a-proposal", `Message ${ProposalMessageID} is not a deal-proposal or deal-counter`);
      }

      const { transcript, Player1ID, Player2ID } = loaded;

      // A pair mismatch or a speaker outside the conversation is a CALLER BUG, not a lost race:
      // the caller addressed the wrong conversation. Throw rather than returning a conflict, so
      // it never gets retried or reported to a player as "someone beat you to it".
      if (Player1ID !== player1ID || Player2ID !== player2ID) {
        throw new Error(
          `Proposal message ${ProposalMessageID} belongs to conversation (${Player1ID}, ${Player2ID}), not (${player1ID}, ${player2ID})`
        );
      }
      if (SpeakerID !== Player1ID && SpeakerID !== Player2ID) {
        throw new Error(
          `SpeakerID ${SpeakerID} must be one of the two endpoints (${Player1ID}, ${Player2ID})`
        );
      }

      // Idempotency first: an existing rejection of THIS proposal settles the call before any
      // staleness check, so a retry of a rejection that has since been superseded still reports
      // the outcome it actually produced rather than a confusing conflict.
      const priorReject = transcript.find(
        (message) =>
          message.MessageType === "deal-reject" &&
          answeredProposalID(message) === ProposalMessageID
      );
      if (priorReject) {
        if (priorReject.SpeakerID === SpeakerID) {
          return {
            Result: "already-rejected" as const,
            ProposalMessageID,
            AlreadyRejected: true,
            Row: projectStoredDealRow(priorReject, "deal-reject"),
          };
        }
        return conflict(
          "rejected-by-other",
          `Proposal message ${ProposalMessageID} was already rejected by endpoint ${priorReject.SpeakerID}`
        );
      }

      const closingResponse = findAnswer(transcript, ProposalMessageID, ACCEPTING_TYPES);
      if (closingResponse) {
        return conflict(
          "answered",
          `Proposal message ${ProposalMessageID} is not open; it was answered by ${closingResponse.MessageType}`
        );
      }

      if (!isCurrentProposal(transcript, ProposalMessageID)) {
        return conflict(
          "superseded",
          `Proposal message ${ProposalMessageID} is not the current active proposal`
        );
      }

      // The row is built from the loaded conversation, so it carries the proposal's STORED roles
      // rather than anything caller-supplied: a rejection can never re-label the endpoints.
      const rejection = buildDealOutcomeRow({
        conversation: loaded,
        speakerID: SpeakerID,
        messageType: "deal-reject",
        content,
        proposalMessageID: ProposalMessageID,
        turn,
      });
      const inserted = await transaction
        .insertInto("DiplomaticMessages")
        .values(rejection.values as any)
        .returning(["ID", "CreatedAt"])
        .executeTakeFirstOrThrow();

      return {
        Result: "rejected" as const,
        ProposalMessageID,
        AlreadyRejected: false,
        Row: rejection.project(inserted),
      };
    });
  }
}

/** Creates a new instance of the reject-agent-deal tool. */
export default function createRejectAgentDealTool() {
  return new RejectAgentDealTool();
}
