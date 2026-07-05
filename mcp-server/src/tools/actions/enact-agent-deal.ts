/**
 * Tool that enacts an agreed agent deal for real (interactive-diplomacy stage 6).
 *
 * This is the enactment route: the sole writer of the `deal-accept` and `deal-enacted`
 * transcript records (the public `append-message` tool refuses both, a pinned writer-split).
 * It takes a proposal message ID (and, optionally, the complete deal object), reduces the
 * conversation to enforce single-enactment, enacts the deal in-game, then records the agreement.
 *
 * **In-game enactment.** Between the idempotency check and the transcript writes it calls the DLL
 * enact path (`enactDeal` -> `inspect-deal.lua` enact mode -> `Deal:Enact` + `Player:SetPromise`),
 * which, in one atomic Lua invocation, validates every trade item and promise, then transfers the
 * items and applies the promises, bypassing the AI's political refusal while honoring structural
 * legality. A bridge error or an un-enacted result throws and writes nothing (so a `deal-enacted`
 * record never outlives a no-op enactment). On success it appends `deal-accept` (agreement reached)
 * and `deal-enacted` (enactment recorded) against the proposal.
 *
 * Idempotency: the `deal-enacted` record is the idempotency key. A second enactment of a
 * proposal that already has a `deal-enacted` is refused (returns the prior record, `Enacted: false`,
 * since this call did not enact it).
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { knowledgeManager } from "../../server.js";
import { applyVisibility, composeVisibility } from "../../utils/knowledge/visibility.js";
import { DealPayloadSchema } from "../../utils/deal-schema.js";
import { enactDeal } from "../../utils/lua/inspect-deal.js";

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
    "Optional complete deal object. When provided it must match the terms stored on the referenced proposal. Omit to enact those stored terms directly."
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
  Enacted: z.boolean().describe("Whether this call enacted the deal in-game (false on the AlreadyEnacted idempotent path)"),
  Turn: z.number(),
});

/**
 * Tool that enacts an agreed agent deal in-game and records the agreement in the transcript:
 * validates + transfers the trade items and applies the promise commitments via the DLL enact path,
 * then stores `deal-accept` + `deal-enacted`.
 */
class EnactAgentDealTool extends ToolBase {
  readonly name = "enact-agent-deal";

  readonly description =
    "Enact an agreed agent deal by proposal message ID: transfer its trade items and apply its promise commitments in-game (bypassing the AI's political refusal, honoring structural legality), then record acceptance and enactment in the transcript. Idempotent: a second enactment of the same proposal is refused.";

  readonly inputSchema = EnactAgentDealInputSchema;

  readonly outputSchema = EnactAgentDealOutputSchema;

  // Not read-only: it enacts the deal in-game (transfers items, applies promises) and writes
  // transcript records.
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

      // ── Enact the deal in-game (stage 6). The whole validate, then enact-items, then apply-promises
      //    sequence runs in ONE atomic Lua invocation, so validation cannot go stale between check and
      //    act: structurally-illegal items or invalid/already-made promises refuse and write nothing.
      //    The canonical stored terms are enacted (items AND promises), never any caller-supplied Deal.
      //
      //    Bridge-failure policy is INVERTED from the stage-5 stub's read-only re-check: a bridge error
      //    (null) or an un-enacted result now THROWS and writes nothing. The stub's lenient fall-through
      //    was correct for a redundant re-check, but here it would record `deal-enacted` with no in-game
      //    effect and permanently block retry via idempotency. (Watch-item: a DB failure AFTER a
      //    successful enact leaves an enacted deal without its record; accepted, because the write is the
      //    next statement and the DealMade IPC event is the reconciliation signal.) ──
      const enactment = await enactDeal(
        Player1ID,
        Player2ID,
        storedDeal.data.items,
        storedDeal.data.promises
      );
      if (!enactment) {
        throw new Error(
          `Cannot enact proposal ${ProposalMessageID}: the game bridge is unavailable`
        );
      }
      if (!enactment.enacted) {
        const reasons = enactment.reasons?.length
          ? enactment.reasons.join("; ")
          : "the deal could not be enacted";
        throw new Error(`Cannot enact proposal ${ProposalMessageID}: ${reasons}`);
      }

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
        .values(messageRow("deal-enacted", "The deal was enacted.") as any)
        .returning("ID")
        .executeTakeFirstOrThrow();

      return {
        ProposalMessageID,
        AcceptMessageID: accept.ID,
        EnactedMessageID: enacted.ID,
        AlreadyEnacted: false,
        Enacted: true,
        Turn: turn,
      };
    });
  }
}

/** Creates a new instance of the enact-agent-deal tool. */
export default function createEnactAgentDealTool() {
  return new EnactAgentDealTool();
}
