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
 *
 * **Failure split (stage 7.04).** Losing a race over proposal state — the proposal was superseded
 * by a newer one, was answered by a closing response, or the caller is not its recipient — is a
 * structured `Conflict` result rather than a thrown error, so a caller can distinguish a lost race
 * (409-class) from an infrastructure failure (502-class) without parsing message text. Everything
 * else still throws through the MCP error channel: a proposal that does not exist or is not a
 * proposal type, an invalid stored `Payload.Deal`, caller-supplied terms that do not match the
 * stored ones, an unavailable bridge, and a refused enactment.
 *
 * It also returns the full `AcceptRow` / `EnactedRow` projections of the records it wrote (and, on
 * the idempotent path, of the existing enactment record), so a caller can hydrate its live
 * transcript cache from the exact durable rows without rereading the transcript.
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { knowledgeManager } from "../../server.js";
import { DealPayloadSchema } from "../../diplomacy/deals/deal-schema.js";
import { enactDeal } from "../../diplomacy/deals/inspect-deal.js";
import { transcriptRowSchemaFor } from "../../diplomacy/transcript-schema.js";
import {
  answeredProposalID,
  buildDealOutcomeRow,
  findAnswer,
  isCurrentProposal,
  loadProposalConversation,
  projectStoredDealRow,
  RESPONSE_TYPES,
} from "../../diplomacy/deals/deal-outcome.js";

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

/** The durable `deal-accept` row this tool returns on the success path. */
const AcceptRowSchema = transcriptRowSchemaFor("deal-accept");
/** The durable `deal-enacted` row this tool returns on the success and idempotent paths. */
const EnactedRowSchema = transcriptRowSchemaFor("deal-enacted");

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

/**
 * Output schema: the IDs and full row projections of the records written (or the prior enactment
 * when idempotent), OR a structured proposal-state conflict.
 *
 * The two shapes are mutually exclusive. `Conflict` present means the enactment never ran, so the
 * enactment fields are all absent — which is why they are optional here despite being present and
 * unchanged on every success and idempotent path.
 */
const EnactAgentDealOutputSchema = z.object({
  ProposalMessageID: z.number(),
  AcceptMessageID: z.number().optional().describe("Append ID of the deal-accept record (absent when already enacted)"),
  EnactedMessageID: z.number().optional().describe("Append ID of the deal-enacted record (existing one when already enacted; absent on a conflict)"),
  AlreadyEnacted: z.boolean().optional().describe("True when this proposal had already been enacted (no new writes); absent on a conflict"),
  Enacted: z.boolean().optional().describe("Whether this call enacted the deal in-game (false on the AlreadyEnacted idempotent path); absent on a conflict"),
  Turn: z.number().optional().describe("Turn the records carry (absent on a conflict)"),
  AcceptRow: AcceptRowSchema.optional().describe(
    "The durable deal-accept row this call wrote (absent on the AlreadyEnacted idempotent path and on a conflict)"
  ),
  EnactedRow: EnactedRowSchema.optional().describe(
    "The durable deal-enacted row (newly written, or the existing one when already enacted). Absent on a conflict."
  ),
  Conflict: z
    .object({
      Reason: z.enum(["superseded", "answered", "wrong-recipient"]),
      Message: z.string(),
    })
    .optional()
    .describe("Set when proposal state refused the enactment (a lost race, not an infrastructure failure). Mutually exclusive with the enactment fields."),
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

    /**
     * Assemble one structured proposal-state conflict (no enactment, no writes). Only the three
     * race-losing states use this; validation and infrastructure failures still throw.
     */
    const conflict = (
      Reason: NonNullable<z.infer<typeof this.outputSchema>["Conflict"]>["Reason"],
      Message: string
    ): z.infer<typeof this.outputSchema> => ({
      ProposalMessageID,
      Conflict: { Reason, Message },
    });

    // Serialize the read/check/write sequence with all other store writes. This makes the
    // idempotency check authoritative and commits deal-accept + deal-enacted atomically.
    return store.runWriteTransaction(async (transaction) => {
      const loaded = await loadProposalConversation(transaction, ProposalMessageID);
      if (!loaded.ok) {
        // Both load failures are thrown here (unlike rejection, which reports them as conflicts):
        // an enactment aimed at a nonexistent or non-proposal message cannot be resolved by
        // refreshing the conversation, so it is a caller bug, not a lost race.
        throw new Error(
          loaded.failure === "not-found"
            ? `Proposal message ${ProposalMessageID} does not exist`
            : `Message ${ProposalMessageID} is not a deal-proposal or deal-counter`
        );
      }

      const { proposal, transcript, Player1ID, Player2ID } = loaded;

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
          // The existing durable record, projected from storage: the caller's cache should end up
          // holding the row that actually exists, not a reconstruction of what this call would
          // have written. No AcceptRow — this call wrote nothing.
          EnactedRow: projectStoredDealRow(priorEnacted, "deal-enacted"),
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

      // ── The three proposal-STATE checks below are races, not caller bugs: each describes a
      //    conversation that moved on after the caller decided to accept. They return a structured
      //    Conflict so the caller can report "someone beat you to it" (409-class) instead of
      //    guessing from an error string whether the store or the bridge broke (502-class). ──
      if (!isCurrentProposal(transcript, ProposalMessageID)) {
        return conflict(
          "superseded",
          `Proposal message ${ProposalMessageID} is not the current active proposal`
        );
      }
      const closingResponse = findAnswer(transcript, ProposalMessageID, RESPONSE_TYPES);
      if (closingResponse) {
        return conflict(
          "answered",
          `Proposal message ${ProposalMessageID} is not open; it was answered by ${closingResponse.MessageType}`
        );
      }

      // Only the endpoint that did not author the proposal can accept it. A wrong AccepterID is
      // also a race in practice: it is how a caller that prechecked against a now-replaced
      // proposal (whose author was the other endpoint) surfaces here.
      const recipientID = proposal.SpeakerID === Player1ID ? Player2ID : Player1ID;
      const accepterID = AccepterID ?? recipientID;
      if (accepterID !== recipientID) {
        return conflict(
          "wrong-recipient",
          `AccepterID ${accepterID} must be the proposal recipient (${recipientID})`
        );
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

      // Both records share the conversation, speaker, answered proposal, and turn; only the type
      // and outward line differ. The accepter — not the proposal's author — speaks both.
      const outcomeRow = <T extends "deal-accept" | "deal-enacted">(messageType: T, content: string) =>
        buildDealOutcomeRow({
          conversation: loaded,
          speakerID: accepterID,
          messageType,
          content,
          proposalMessageID: ProposalMessageID,
          turn,
        });

      const acceptRow = outcomeRow("deal-accept", Content?.trim() || "The deal was accepted.");
      const enactedRow = outcomeRow("deal-enacted", "The deal was enacted.");
      const accept = await transaction
        .insertInto("DiplomaticMessages")
        .values(acceptRow.values as any)
        .returning(["ID", "CreatedAt"])
        .executeTakeFirstOrThrow();
      const enacted = await transaction
        .insertInto("DiplomaticMessages")
        .values(enactedRow.values as any)
        .returning(["ID", "CreatedAt"])
        .executeTakeFirstOrThrow();

      return {
        ProposalMessageID,
        AcceptMessageID: accept.ID,
        EnactedMessageID: enacted.ID,
        AlreadyEnacted: false,
        Enacted: true,
        Turn: turn,
        AcceptRow: acceptRow.project(accept),
        EnactedRow: enactedRow.project(enacted),
      };
    });
  }
}

/** Creates a new instance of the enact-agent-deal tool. */
export default function createEnactAgentDealTool() {
  return new EnactAgentDealTool();
}
