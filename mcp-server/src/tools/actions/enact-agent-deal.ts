/**
 * Tool that "enacts" an agreed agent deal (interactive-diplomacy stage 5 — STUB).
 *
 * This is the enactment route: the sole writer of the `deal-accept` and `deal-enacted`
 * transcript records (the public `append-message` tool refuses both — pinned writer-split).
 * It takes a proposal message ID (and, optionally, the complete deal object), reduces the
 * conversation to enforce single-enactment, then records the agreement.
 *
 * **Stage-5 stub boundary.** The *in-game* effect — building the `CvDeal`, validating it
 * structurally, calling the DLL `EnactAgentDeal`, and applying promise commitments — does
 * NOT happen yet (the DLL entrypoint lands in stage 6). Here the tool only *stores the
 * transcript*: it appends `deal-accept` (agreement reached) and `deal-enacted` (orchestration
 * recorded) against the proposal so the transcript reduces to an agreed/enacted deal, while
 * no items change hands. Stage 6 inserts the DLL validation + enactment between the
 * idempotency check and these writes, keeping the tool's external contract identical.
 *
 * Idempotency: the `deal-enacted` record is the idempotency key — a second enactment of a
 * proposal that already has a `deal-enacted` is refused (returns the prior record).
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { knowledgeManager } from "../../server.js";
import { applyVisibility, composeVisibility } from "../../utils/knowledge/visibility.js";
import { DealPayloadSchema } from "../../utils/deal-schema.js";

/** Proposal/counter message types an enactment may answer. */
const PROPOSAL_TYPES = new Set(["deal-proposal", "deal-counter"]);

/** Response message types that close an open proposal. */
const RESPONSE_TYPES = new Set(["deal-accept", "deal-reject", "deal-enacted"]);

/** Read a response message's referenced proposal ID. */
function answeredProposalID(message: { Payload: unknown }): number | undefined {
  const id = (message.Payload as Record<string, unknown> | undefined)?.ProposalMessageID;
  return typeof id === "number" ? id : undefined;
}

/** Recursively key-sort an object tree so structural comparison ignores key ordering. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

/**
 * Compare a caller-supplied deal with the canonical stored proposal terms by their
 * game-relevant fields only. The advisory `rationale` / `message` are not game state
 * (ignored by inspect-deal), so they must never affect the match; the comparison is also
 * insensitive to object key ordering.
 */
function dealsMatch(left: z.infer<typeof DealPayloadSchema>, right: z.infer<typeof DealPayloadSchema>): boolean {
  const terms = (deal: z.infer<typeof DealPayloadSchema>) =>
    JSON.stringify(canonicalize({ version: deal.version, items: deal.items, promises: deal.promises }));
  return terms(left) === terms(right);
}

/** Input schema for the enact-agent-deal tool. */
const EnactAgentDealInputSchema = z.object({
  ProposalMessageID: z
    .number()
    .int()
    .describe("Append ID of the deal-proposal / deal-counter being enacted"),
  Deal: DealPayloadSchema.optional().describe(
    "Optional complete deal object. Omit to enact the terms stored on the referenced proposal. (Stage 6 uses this for DLL enactment.)"
  ),
  AccepterID: z
    .number()
    .int()
    .optional()
    .describe(
      "The endpoint accepting/enacting the deal. Defaults to the proposal's recipient (the endpoint that did not author it)."
    ),
  Content: z.string().optional().describe("Optional outward line recorded with the acceptance."),
});

/** Output schema: the IDs of the records written (or the prior enactment when idempotent). */
const EnactAgentDealOutputSchema = z.object({
  ProposalMessageID: z.number(),
  AcceptMessageID: z.number().optional().describe("Append ID of the deal-accept record (absent when already enacted)"),
  EnactedMessageID: z.number().describe("Append ID of the deal-enacted record (existing one when already enacted)"),
  AlreadyEnacted: z.boolean().describe("True when this proposal had already been enacted (no new writes)"),
  Enacted: z.boolean().describe("Whether the in-game deal was actually enacted (false in the stage-5 stub)"),
  Turn: z.number(),
});

/**
 * Tool that records the agreement/enactment of an agent deal in the transcript.
 * Stage-5 stub: stores `deal-accept` + `deal-enacted`, skips the DLL in-game enactment.
 */
class EnactAgentDealTool extends ToolBase {
  readonly name = "enact-agent-deal";

  readonly description =
    "Enact an agreed agent deal by proposal message ID, recording acceptance and enactment in the transcript. STUB: does not yet apply in-game effects (DLL enactment arrives in stage 6).";

  readonly inputSchema = EnactAgentDealInputSchema;

  readonly outputSchema = EnactAgentDealOutputSchema;

  // Not read-only — it writes transcript records — but it does not (yet) mutate game state.
  readonly annotations: ToolAnnotations = { readOnlyHint: false };

  readonly metadata = {
    autoComplete: [],
  };

  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const { ProposalMessageID, AccepterID, Content, Deal } = args;
    const store = knowledgeManager.getStore();
    const turn = knowledgeManager.getTurn();

    // Serialize the read/check/write sequence with all other store writes. This makes the
    // idempotency check authoritative and commits deal-accept + deal-enacted atomically.
    return store.runWriteTransaction(async (transaction) => {
      const proposal = await transaction
        .selectFrom("DiplomaticMessages")
        .selectAll()
        .where("ID", "=", ProposalMessageID)
        .executeTakeFirst();
      if (!proposal) {
        throw new Error(`Proposal message ${ProposalMessageID} does not exist`);
      }
      if (!PROPOSAL_TYPES.has(proposal.MessageType)) {
        throw new Error(`Message ${ProposalMessageID} is not a deal-proposal or deal-counter`);
      }

      const { Player1ID, Player2ID, Player1Role, Player2Role } = proposal;
      const transcript = await transaction
        .selectFrom("DiplomaticMessages")
        .selectAll()
        .where("Player1ID", "=", Player1ID)
        .where("Player2ID", "=", Player2ID)
        .orderBy("ID")
        .execute();

      // A completed prior call remains idempotent even if a newer proposal is now active.
      const priorEnacted = transcript.find(
        (message) =>
          message.MessageType === "deal-enacted" &&
          answeredProposalID(message) === ProposalMessageID
      );
      if (priorEnacted) {
        return {
          ProposalMessageID,
          EnactedMessageID: priorEnacted.ID,
          AlreadyEnacted: true,
          Enacted: false,
          Turn: priorEnacted.Turn,
        };
      }

      // The proposal ID is only an identifier; the stored payload is the canonical deal.
      const storedDeal = DealPayloadSchema.safeParse(
        (proposal.Payload as Record<string, unknown> | undefined)?.Deal
      );
      if (!storedDeal.success) {
        throw new Error(`Proposal message ${ProposalMessageID} has an invalid Payload.Deal`);
      }
      if (Deal && !dealsMatch(Deal, storedDeal.data)) {
        throw new Error(`Deal does not match the terms stored on proposal ${ProposalMessageID}`);
      }

      const activeProposal = [...transcript]
        .reverse()
        .find((message) => PROPOSAL_TYPES.has(message.MessageType));
      if (activeProposal?.ID !== ProposalMessageID) {
        throw new Error(`Proposal message ${ProposalMessageID} is not the current active proposal`);
      }
      const closingResponse = transcript.find(
        (message) =>
          message.ID > ProposalMessageID &&
          RESPONSE_TYPES.has(message.MessageType) &&
          answeredProposalID(message) === ProposalMessageID
      );
      if (closingResponse) {
        throw new Error(
          `Proposal message ${ProposalMessageID} is not open; it was answered by ${closingResponse.MessageType}`
        );
      }

      // Only the endpoint that did not author the proposal can accept it.
      const recipientID = proposal.SpeakerID === Player1ID ? Player2ID : Player1ID;
      const accepterID = AccepterID ?? recipientID;
      if (accepterID !== recipientID) {
        throw new Error(`AccepterID ${accepterID} must be the proposal recipient (${recipientID})`);
      }

      // ── Stage 6 will insert DLL validation + EnactAgentDeal here, using storedDeal.data
      //    and applying promise commitments before the transcript records are committed. ──

      const visibilityFlags = composeVisibility([Player1ID, Player2ID]);

      /** Build one fully stamped transcript row for this atomic transaction. */
      const messageRow = (
        messageType: "deal-accept" | "deal-enacted",
        content: string
      ): Record<string, unknown> =>
        applyVisibility(
          {
            Player1ID,
            Player2ID,
            Player1Role,
            Player2Role,
            SpeakerID: accepterID,
            MessageType: messageType,
            Content: content,
            Payload: { ProposalMessageID },
            Turn: turn,
          } as any,
          visibilityFlags
        );

      const acceptContent = Content?.trim() || "The deal was accepted.";
      const accept = await transaction
        .insertInto("DiplomaticMessages")
        .values(messageRow("deal-accept", acceptContent) as any)
        .returning("ID")
        .executeTakeFirstOrThrow();
      const enacted = await transaction
        .insertInto("DiplomaticMessages")
        .values(
          messageRow(
            "deal-enacted",
            "The deal was enacted (in-game effects pending stage 6)."
          ) as any
        )
        .returning("ID")
        .executeTakeFirstOrThrow();

      return {
        ProposalMessageID,
        AcceptMessageID: accept.ID,
        EnactedMessageID: enacted.ID,
        AlreadyEnacted: false,
        Enacted: false,
        Turn: turn,
      };
    });
  }
}

/** Creates a new instance of the enact-agent-deal tool. */
export default function createEnactAgentDealTool() {
  return new EnactAgentDealTool();
}
