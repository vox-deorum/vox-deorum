/**
 * Shared mechanics for the two transactional deal-outcome routes, `enact-agent-deal` (which owns
 * `deal-accept` + `deal-enacted`) and `reject-agent-deal` (which owns `deal-reject`).
 *
 * Both tools run the same shape inside one `store.runWriteTransaction`: load a proposal by ID,
 * confirm it really is a proposal, read its pair's whole ordered transcript, scan that transcript
 * for rows answering the proposal, then stamp and insert one or more outcome rows. Keeping those
 * steps here means the two routes cannot drift in how they read the conversation or in the shape of
 * the durable rows they hand back — a drift that would be invisible until a caller's transcript
 * cache disagreed with the store.
 *
 * What deliberately does NOT live here is *classification*. The two routes read the same states and
 * reach different verdicts on purpose: a wrong accepter matters only to enactment, an existing
 * rejection by the other endpoint only to rejection, and a missing proposal is a thrown error for
 * one and a structured conflict for the other. So every function below reports what it found and
 * lets the caller decide what that means.
 */

import type { Selectable, Transaction } from "kysely";
import type { KnowledgeDatabase } from "../../knowledge/schema/base.js";
import type { DiplomaticMessage } from "../../knowledge/schema/timed.js";
import { applyVisibility, composeVisibility } from "../../knowledge/helpers/visibility.js";
import type { MessageType, TranscriptMessage } from "../transcript-schema.js";

/** One stored transcript row as read back inside a transaction (JSON columns already parsed). */
export type StoredDiplomaticMessage = Selectable<DiplomaticMessage>;

/** Proposal/counter message types an outcome may answer. */
export const PROPOSAL_TYPES: ReadonlySet<string> = new Set(["deal-proposal", "deal-counter"]);

/** The three terminal response types that close an open proposal. */
export const RESPONSE_TYPES: ReadonlySet<string> = new Set([
  "deal-accept",
  "deal-reject",
  "deal-enacted",
]);

/** The message types the two transactional routes write as a proposal's outcome. */
export type DealOutcomeMessageType = Extract<
  MessageType,
  "deal-accept" | "deal-enacted" | "deal-reject"
>;

/**
 * The projected wire row a deal-outcome route returns for the record it wrote (or found already
 * written), narrowed to that record's single message type. Structurally a `TranscriptMessage`, so a
 * caller can merge it straight into a live transcript cache.
 */
export type DealOutcomeRow<T extends DealOutcomeMessageType> = Omit<TranscriptMessage, "MessageType"> & {
  MessageType: T;
};

/**
 * Read a response message's referenced proposal ID from its payload.
 *
 * @param message - Any stored transcript row
 * @returns The `Payload.ProposalMessageID` it answers, or undefined when it answers nothing
 */
export function answeredProposalID(message: { Payload: unknown }): number | undefined {
  const id = (message.Payload as Record<string, unknown> | undefined)?.ProposalMessageID;
  return typeof id === "number" ? id : undefined;
}

/** A proposal that could not be loaded, and why — the caller decides how to report it. */
export type ProposalLoadFailure = "not-found" | "not-a-proposal";

/** A loaded proposal together with the conversation it belongs to. */
export interface ProposalConversation {
  ok: true;
  /** The `deal-proposal` / `deal-counter` row itself. */
  proposal: StoredDiplomaticMessage;
  /** Every message in that pair's conversation, ordered by append ID. */
  transcript: StoredDiplomaticMessage[];
  /** The conversation's ordered endpoints and their stored roles, lifted off the proposal. */
  Player1ID: number;
  Player2ID: number;
  Player1Role: string;
  Player2Role: string;
}

/** Either a loaded proposal conversation or the reason it could not be loaded. */
export type ProposalConversationResult = ProposalConversation | { ok: false; failure: ProposalLoadFailure };

/**
 * Load a proposal and its pair's full ordered transcript inside a write transaction.
 *
 * Reading the whole conversation (rather than targeted existence queries) is deliberate: every
 * subsequent decision — idempotency, "is this still the open offer", "was it already answered" — is
 * made against one consistent snapshot taken inside the transaction, so no two checks can disagree.
 *
 * The endpoints and roles come from the PROPOSAL row, never from caller input, so an outcome row
 * always inherits the identities the conversation was archived with.
 *
 * @param transaction - The open write transaction to read through
 * @param proposalMessageID - Append ID of the proposal/counter being answered
 * @returns The proposal, its transcript, and the conversation's endpoints; or a load failure
 */
export async function loadProposalConversation(
  transaction: Transaction<KnowledgeDatabase>,
  proposalMessageID: number
): Promise<ProposalConversationResult> {
  const proposal = await transaction
    .selectFrom("DiplomaticMessages")
    .selectAll()
    .where("ID", "=", proposalMessageID)
    .executeTakeFirst();
  if (!proposal) return { ok: false, failure: "not-found" };
  if (!PROPOSAL_TYPES.has(proposal.MessageType)) return { ok: false, failure: "not-a-proposal" };

  const { Player1ID, Player2ID, Player1Role, Player2Role } = proposal;
  const transcript = await transaction
    .selectFrom("DiplomaticMessages")
    .selectAll()
    .where("Player1ID", "=", Player1ID)
    .where("Player2ID", "=", Player2ID)
    .orderBy("ID")
    .execute();

  return { ok: true, proposal, transcript, Player1ID, Player2ID, Player1Role, Player2Role };
}

/**
 * Find the first row in a transcript that answers a proposal with one of the given message types.
 *
 * The `ID > proposalMessageID` guard is redundant in practice — a row can only reference an append
 * ID that already existed when it was written — but it is kept as the cheap invariant it states:
 * an answer never precedes what it answers.
 *
 * @param transcript - The pair's ordered conversation
 * @param proposalMessageID - The proposal being answered
 * @param messageTypes - Which answer types to look for
 * @returns The earliest matching row, or undefined when the proposal has no such answer
 */
export function findAnswer(
  transcript: StoredDiplomaticMessage[],
  proposalMessageID: number,
  messageTypes: ReadonlySet<string>
): StoredDiplomaticMessage | undefined {
  return transcript.find(
    (message) =>
      message.ID > proposalMessageID &&
      messageTypes.has(message.MessageType) &&
      answeredProposalID(message) === proposalMessageID
  );
}

/**
 * Whether a proposal is still the newest proposal/counter in its conversation — i.e. the offer
 * currently on the table. A later counter supersedes it, and answering a superseded offer is a lost
 * race rather than a valid outcome.
 *
 * @param transcript - The pair's ordered conversation
 * @param proposalMessageID - The proposal being answered
 * @returns True when no newer proposal/counter exists in the conversation
 */
export function isCurrentProposal(
  transcript: StoredDiplomaticMessage[],
  proposalMessageID: number
): boolean {
  const activeProposal = [...transcript]
    .reverse()
    .find((message) => PROPOSAL_TYPES.has(message.MessageType));
  return activeProposal?.ID === proposalMessageID;
}

/** Everything needed to stamp one outcome row for a proposal. */
export interface DealOutcomeRowSpec {
  /** The conversation the row belongs to (endpoints + their stored roles). */
  conversation: Pick<ProposalConversation, "Player1ID" | "Player2ID" | "Player1Role" | "Player2Role">;
  /** The endpoint authoring this outcome. */
  speakerID: number;
  /** Which outcome this row records. */
  messageType: DealOutcomeMessageType;
  /** The outward line stored on the row. */
  content: string;
  /** The proposal this outcome answers, recorded in `Payload.ProposalMessageID`. */
  proposalMessageID: number;
  /** The game turn to stamp. */
  turn: number;
}

/**
 * Build one fully stamped outcome row: the column values to insert, plus the projection of the
 * row that insert produces.
 *
 * Both come out of a single description on purpose. The projection is what the caller hydrates its
 * transcript cache from, so if it were written separately from the insert the two could disagree
 * about content, roles, or payload and nothing would catch it — the caller would simply be holding
 * a row the store never contained.
 *
 * @param spec - The row's conversation, speaker, type, content, answered proposal, and turn
 * @returns `values` to pass to the insert, and `project` to apply to its RETURNING result
 */
export function buildDealOutcomeRow<T extends DealOutcomeMessageType>(
  spec: DealOutcomeRowSpec & { messageType: T }
): {
  values: Record<string, unknown>;
  project: (inserted: { ID: number; CreatedAt: number }) => DealOutcomeRow<T>;
} {
  const { conversation, speakerID, messageType, content, proposalMessageID, turn } = spec;
  const { Player1ID, Player2ID, Player1Role, Player2Role } = conversation;
  const payload = { ProposalMessageID: proposalMessageID };

  return {
    // Visibility is set only for the real participant(s); composeVisibility ignores the observer
    // sentinel and any out-of-range slot, which have no visibility column. The cast mirrors the
    // rest of the store path: the insert type carries Generated<>/JSONColumnType<> wrappers that
    // the plain row literal deliberately does not.
    values: applyVisibility(
      {
        Player1ID,
        Player2ID,
        Player1Role,
        Player2Role,
        SpeakerID: speakerID,
        MessageType: messageType,
        Content: content,
        Payload: payload,
        Turn: turn,
      } as any,
      composeVisibility([Player1ID, Player2ID])
    ) as Record<string, unknown>,

    // The insert's RETURNING supplies the two server-generated fields (the append ID and the
    // SQLite `unixepoch()` CreatedAt); everything else is exactly what was written above.
    project: (inserted) => ({
      ID: inserted.ID,
      Player1ID,
      Player2ID,
      Player1Role,
      Player2Role,
      SpeakerID: speakerID,
      MessageType: messageType,
      Content: content,
      Payload: payload,
      Turn: turn,
      CreatedAt: inserted.CreatedAt,
    }),
  };
}

/**
 * Project an outcome row that ALREADY exists in the store into the same wire shape a freshly
 * written one gets. This is what the idempotent paths return: a repeat call should publish the row
 * that actually exists, not a reconstruction of what it would have written.
 *
 * @param row - The stored outcome row, read inside the transaction
 * @param messageType - Its message type, narrowed for the caller's output schema
 * @returns The projected wire row
 */
export function projectStoredDealRow<T extends DealOutcomeMessageType>(
  row: StoredDiplomaticMessage,
  messageType: T
): DealOutcomeRow<T> {
  return {
    ID: row.ID,
    Player1ID: row.Player1ID,
    Player2ID: row.Player2ID,
    Player1Role: row.Player1Role,
    Player2Role: row.Player2Role,
    SpeakerID: row.SpeakerID,
    MessageType: messageType,
    Content: row.Content,
    Payload: (row.Payload ?? {}) as Record<string, unknown>,
    Turn: row.Turn,
    CreatedAt: row.CreatedAt,
  };
}
