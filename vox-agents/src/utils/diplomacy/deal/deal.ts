/**
 * @module utils/diplomacy/deal
 *
 * Deal-action I/O between the conversation clients (the Web deal screen from interactive-diplomacy
 * stage 4, and the in-game panel from stage 7) and the mcp-server: read-only `inspect-deal`
 * inspection plus the typed deal-action transcript writes.
 *
 * The writers split by who owns the decision:
 *  - `deal-proposal` / `deal-counter` are archival `append-message` writes (specs §6): the row is
 *    archived, nothing streams, notifies, runs agents, or enacts. They are a single "submit a deal"
 *    action that commits as the turn's commit point through the unified streaming
 *    `/api/agents/message` path (so the diplomat's reply streams after); `appendDealProposal` is the
 *    shared chokepoint both that path and the negotiator's tool use, and `classifyDealSubmission`
 *    reconciles the submission against the live offer state under the turn lock;
 *  - `deal-reject` goes through the transactional `reject-agent-deal` action (stage 7.04), which owns
 *    rejection idempotency and staleness in one serialized store transaction;
 *  - `deal-accept` / `deal-enacted` go through the enactment route (`enact-agent-deal`, stage 6),
 *    their only writer (pinned contract).
 *
 * `append-message` refuses all three of the outcome types, so no caller can bypass the transactional
 * actions. Both of those actions hand back the exact durable rows they committed, so a caller
 * hydrates its live cache — and the panel its transcript — without ever rereading the transcript.
 *
 * The per-item value snapshots stored on a proposal (`Payload.Value1` / `Payload.Value2`)
 * are computed here from a fresh `inspect-deal` before archival, so the stored snapshot
 * reflects the live `GetTradeItemValue` of each item to each ordered player. The trade
 * screen's other-side total balance is summed from these on the client — never stored as a
 * precomputed total (specs §3, deal-schema PerItemValueMap).
 */

import type { EnvoyThread } from "../../../types/index.js";
import { mcpClient } from "../../models/mcp-client.js";
import { unwrapMcpResponse } from "../../models/mcp-response.js";
import type { TranscriptMessage, TranscriptPushMessage } from "../transcript/transcript-utils.js";
import { civNameFor } from "../transcript/transcript-utils.js";
import { reportThreadRow, reportThreadRows } from "../turn/active-turn-state.js";
import { appendCloseMessage, readTranscript } from "../transcript/transcript.js";
import { createLogger } from "../../logger.js";
import { errorMessage } from "../../errors.js";
import { deriveActiveProposal, type DealReduction } from "./deal-reduce.js";
// Pinned deal contract — the single source of truth shared across stages 4–6.
import {
  DealPayloadSchema,
  applyDealDurations,
  resolveItemName,
  symmetrizeDeal,
  withPeaceTreaty,
  TARGETED_PROMISE_TYPES,
  isDealMessage,
  type DealPayload,
  type DealTranscriptMessage,
  type PerItemValueMap,
} from "../../../../../mcp-server/dist/utils/deal-schema.js";
// Friendly, game-facing labels for illegal-term error lines (single source of truth in mcp-server).
import { formatItemLabel, formatPromiseLabel, itemTypeLabel } from "../../../../../mcp-server/dist/utils/deal-format.js";
import type {
  InspectDealResponse,
} from "../../../../../mcp-server/dist/tools/knowledge/inspect-deal.js";

const logger = createLogger("diplomacy:deal");

/** One untradeable trade item, structured so programmatic consumers (the negotiator's Give/Receive
 *  reframe) never have to parse the human-readable reason strings. */
export interface IllegalTradeItemTerm {
  kind: "item";
  itemType: string;
  fromPlayerID: number;
  toPlayerID: number;
  reasons: string[];
  /** Display label with the authored amount/name, e.g. "Gold: 59". */
  label?: string;
}

/** One impossible promise commitment, in the same structured shape as an illegal trade item. */
export interface IllegalPromiseTerm {
  kind: "promise";
  promiseType: string;
  /** The endpoint that would be bound by the commitment (its "giver"). */
  promiserID: number;
  recipientID: number;
  /** The third party a Coop War / city-state promise is about, when the type takes one. */
  targetPlayerID?: number;
  reasons: string[];
}

/**
 * One refused deal term. A discriminated union rather than a bare trade item, because since stage
 * 7.04 promises are gated too: the negotiator's Give/Receive reframe has to tell an impossible
 * commitment from an untradeable item, and it must do so from structured data rather than by parsing
 * the display strings assembled for the UI toast.
 */
export type IllegalDealTerm = IllegalTradeItemTerm | IllegalPromiseTerm;

/**
 * Thrown when a deal carries a term the game reports as impossible — an untradeable trade item or a
 * commitment that could not be made under current game state. This is a client/agent error (a bad
 * proposal), distinct from a bridge/store failure, so callers can map it to a 4xx (UI) or relay the
 * per-term reasons back to the model (negotiator) instead of treating it as 5xx.
 */
export class IllegalDealError extends Error {
  /** Human-readable display lines, one per illegal term ("<friendly label> (<giver> → <receiver>): reason").
   *  The joined form is the error message; the UI toast shows it verbatim. */
  readonly reasons: string[];
  /** Structured per-term detail for programmatic consumers (empty for structural validation errors,
   *  which carry no inspected term — the negotiator then relays `reasons` verbatim). */
  readonly details: IllegalDealTerm[];
  constructor(reasons: string[], details: IllegalDealTerm[] = []) {
    super(`Deal contains terms that cannot be made: ${reasons.join("; ")}`);
    this.name = "IllegalDealError";
    this.reasons = reasons;
    this.details = details;
  }
}

/**
 * Thrown when a deal action targets a proposal that is no longer the active open offer — a concurrent
 * reject, counter, or close changed it under the actor between render and the durable write. This is a
 * lost-race conflict, not an infra failure or a malformed deal, so routes map it to 409 (the actor
 * should re-read the current proposal and retry), distinct from `IllegalDealError` (400) and store
 * failures (502).
 */
export class ProposalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalConflictError";
  }
}

/** Deal message types that carry proposed terms in Payload.Deal. */
export type DealProposalType = "deal-proposal" | "deal-counter";

/** The full `inspect-deal` result for a pair + (optional) proposed deal. Owned by the mcp-server
 *  `inspect-deal` tool; aliased here under the agent-facing name so all deal code shares one
 *  canonical shape (index-aligned `items` / `promises`, tradable ranges, and duration hints)
 *  instead of a hand-maintained copy that can silently drift from the tool's return type. */
export type InspectDealResult = InspectDealResponse;

/** Unwrap the structured tool result, throwing on MCP error envelopes. */
function unwrap<T>(result: unknown, context: string): T {
  return unwrapMcpResponse(result, context) as T;
}

/**
 * Read-only `inspect-deal` for a conversation's endpoint pair against live game state.
 * Passing an empty/omitted deal returns the tradable range only; passing a constructed
 * deal additionally returns per-term legality + both-direction value and per-promise
 * agreeability factors. The inspector itself gates nothing; the per-term legality it reports
 * is enforced by the writers that consume it (`appendDealProposal` rejects untradeable items
 * at authoring; enactment re-checks before applying). Promise agreeability stays advisory.
 */
export async function inspectDeal(
  playerAID: number,
  playerBID: number,
  deal?: DealPayload
): Promise<InspectDealResult> {
  const args: Record<string, unknown> = { PlayerAID: playerAID, PlayerBID: playerBID };
  if (deal) args.ProposedDeal = deal;
  const result = await mcpClient.callTool("inspect-deal", args);
  return unwrap<InspectDealResult>(result, "inspect-deal");
}

/** True when a directed term runs between the conversation's two endpoints. */
function isConversationDirection(
  fromPlayerID: number,
  toPlayerID: number,
  player1ID: number,
  player2ID: number
): boolean {
  return (
    (fromPlayerID === player1ID && toPlayerID === player2ID) ||
    (fromPlayerID === player2ID && toPlayerID === player1ID)
  );
}

/**
 * Validate the transcript-level invariants that must hold even when live inspection is
 * unavailable. This keeps malformed endpoint terms and incomplete targeted promises out
 * of the durable store; live structural legality remains advisory.
 */
export function validateDealForThread(thread: EnvoyThread, deal: DealPayload): void {
  // A malformed deal is a client/agent error, not an infra failure — throw IllegalDealError (the one
  // typed deal-error the route maps to 400) so it can't be miscategorized as a generic 502.
  for (const [index, item] of deal.items.entries()) {
    if (!isConversationDirection(item.fromPlayerID, item.toPlayerID, thread.player1ID, thread.player2ID)) {
      throw new IllegalDealError([`deal.items[${index}] must be directed between the conversation endpoints`]);
    }
  }

  for (const [index, promise] of deal.promises.entries()) {
    if (!isConversationDirection(promise.promiserID, promise.recipientID, thread.player1ID, thread.player2ID)) {
      throw new IllegalDealError([`deal.promises[${index}] must be directed between the conversation endpoints`]);
    }
    // Only promises the tactical AI honors exist in the contract (PROMISE_TYPES / PROMISE_METADATA), so
    // `DealPayloadSchema` already rejects any non-honored promise at the parse boundary both writer
    // paths go through (the Web route and the negotiator's ledger). Nothing extra to guard here beyond
    // the targeted-promise requirement below.
    if (TARGETED_PROMISE_TYPES.has(promise.promiseType)) {
      if (
        promise.targetPlayerID === undefined ||
        promise.targetPlayerID < 0 ||
        promise.targetPlayerID === thread.player1ID ||
        promise.targetPlayerID === thread.player2ID
      ) {
        throw new IllegalDealError([`deal.promises[${index}] with type ${promise.promiseType} requires a third-party targetPlayerID`]);
      }
    }
  }
}

/**
 * Compute the per-item value snapshots for the two ordered players from an `inspect-deal`
 * result. `Value1` is keyed by trade-item index → that item's value from `player1ID`'s
 * perspective (what it is worth to give it if player1 is the giver, else to receive it);
 * `Value2` is the same from `player2ID`'s perspective. Promises are excluded (their
 * agreeability is factor-based, not a value). The inspected items are index-aligned with
 * the proposed `deal.items`.
 */
export function computeValueMaps(
  inspection: InspectDealResult,
  player1ID: number,
  player2ID: number
): { value1: PerItemValueMap; value2: PerItemValueMap } {
  const value1: PerItemValueMap = {};
  const value2: PerItemValueMap = {};
  inspection.items.forEach((it, index) => {
    const key = String(index);
    value1[key] = it.fromPlayerID === player1ID ? it.valueIfIGive : it.valueIfIReceive;
    value2[key] = it.fromPlayerID === player2ID ? it.valueIfIGive : it.valueIfIReceive;
  });
  return { value1, value2 };
}

/**
 * Stamp each data-bearing item's referenced entity name (resource / city / tech / third-party team /
 * vote resolution) from a fresh inspection, so the stored deal carries the localized display name and
 * read surfaces without a live tradable range (the inline card, the diplomat/negotiator prompt) can
 * label it instead of a bare `#<id>`. Names are resolved once via the shared {@link resolveItemName}
 * (the single ID→name mapping), keyed by the giver's range; items with no name (gold/toggles/pacts) or
 * a missing candidate are left unchanged. Returns a new deal; the input is not mutated.
 */
function stampItemNames(deal: DealPayload, inspection: InspectDealResult): DealPayload {
  return {
    ...deal,
    items: deal.items.map((item) => {
      const name = resolveItemName(item, inspection.tradableRange[String(item.fromPlayerID)]);
      return name ? { ...item, name } : item;
    }),
  };
}

/**
 * Inspect a deal about to be archived, turning any bridge failure into a plain error so the caller
 * never stores a proposal it could not evaluate.
 */
async function inspectForArchival(thread: EnvoyThread, deal: DealPayload): Promise<InspectDealResult> {
  try {
    return await inspectDeal(thread.player1ID, thread.player2ID, deal);
  } catch (error) {
    logger.error("Could not inspect proposal before archival", { error });
    throw new Error(
      `Could not inspect deal before storing proposal: ${errorMessage(error, "unknown error")}`
    );
  }
}

/**
 * Append a `deal-proposal` / `deal-counter` to the durable store, computing and attaching
 * the proposal-time per-item value snapshots from a fresh inspection before the archival
 * write. The speaker is the endpoint authoring the move (the human/caller in stage-4
 * preview).
 *
 * Durations and display names are not author-supplied (specs §3): before archival the deal is
 * normalized via `applyDealDurations` (stamping each duration-bearing item's fixed game duration —
 * deal / peace / relationship, by type) and `stampItemNames` (stamping each data-bearing item's
 * referenced entity name), both from the fresh inspection. So the stored `Payload.Deal` always carries
 * the right durations and a name any read surface can show without a live range, whether it came from
 * the Web editor or an agent that proposed neither.
 *
 * The transcript Content is derived from `deal.message` (the proposal's one-line note); callers no
 * longer pass it separately. A blank message falls back to a per-type default.
 *
 * @returns the stored row's append ID and server-stamped turn (the values `read-transcript`
 *          will later report), the proposal-time inspection when available so an agent caller can
 *          immediately brief the diplomat without re-reading or re-inspecting, the canonical
 *          (duration-stamped) deal exactly as it was archived, and the full authoritative
 *          `row` (real ID + value snapshots) so the streaming route can emit it over SSE without
 *          a reread.
 */
export async function appendDealProposal(
  thread: EnvoyThread,
  speakerID: number,
  messageType: DealProposalType,
  deal: DealPayload
): Promise<{ id: number; turn?: number; inspection?: InspectDealResult; deal: DealPayload; row: DealTranscriptMessage }> {
  // The proposal's transcript Content is its one-line note; never a separately-passed field (the UI
  // and negotiator both put the line on the deal). Blank → a per-type default so the row is never empty.
  const content = deal.message?.trim() || (messageType === "deal-counter" ? "A deal was countered." : "A deal was proposed.");
  // Mutual agreements (DoF / defensive pact / research agreement / peace) bind both sides — complete
  // any one-sided pact up front so the inspection, legality guard, value snapshots, and stored deal
  // all reflect the symmetric term (mirrors what the Web editor does on add). Same chokepoint for the
  // UI and negotiator paths, so neither can archive a one-sided pact the game would reject.
  let symmetricDeal = symmetrizeDeal(deal);

  // Transcript-shape validation is not best-effort: malformed terms must never be archived.
  validateDealForThread(thread, symmetricDeal);

  // Required value/agreement snapshot: if the game can't inspect this proposal right now,
  // do not archive a deal the diplomat/negotiator cannot evaluate faithfully.
  let inspection = await inspectForArchival(thread, symmetricDeal);

  // Every deal between warring civs is a peace deal, exactly as the in-game trade screen makes it:
  // the agent path's human-to-human legality skips the stock at-war block, so without this a
  // commercial package could be enacted while the war goes on. The treaty is added here, not by the
  // author, and re-inspected so its legality (a war lock refuses it below) and value are real.
  if (inspection.atWar && !symmetricDeal.items.some((item) => item.itemType === "PEACE_TREATY")) {
    symmetricDeal = withPeaceTreaty(symmetricDeal, thread.player1ID, thread.player2ID);
    inspection = await inspectForArchival(thread, symmetricDeal);
  }

  // Hard legality guard: a proposal carrying any impossible term must never be archived.
  // The same per-term legality that drives the board's red rows gates the write — so a hidden item
  // category (bonus resource, ruleset-disabled RA/tech/vassalage), any pairing-illegal item, AND
  // (since stage 7.04) a dead-on-arrival promise are rejected here, for both the UI and the
  // negotiator paths that share this function. Promise legality is binding exactly like item
  // legality; only `agreeabilityFactors` stays advisory. The inspected items/promises are
  // index-aligned with `symmetricDeal`, so the authored term (for a friendly, data-bearing label) is
  // available by index; civ names come from the thread's stored identities.
  const civName = civNameFor(thread);
  const illegalItems = inspection.items
    .map((it, index) => ({ it, index }))
    .filter(({ it }) => !it.legality)
    // Resolved once per term: the authored item (index-aligned with `symmetricDeal`) for a friendly,
    // data-bearing label, falling back to the bare item-type name only when it's missing.
    .map(({ it, index }) => {
      const item = symmetricDeal.items[index];
      return { it, label: item ? formatItemLabel(item) : itemTypeLabel(it.itemType) };
    });
  const illegalPromises = inspection.promises
    .map((promise, index) => ({ promise, index }))
    .filter(({ promise }) => !promise.legality);
  if (illegalItems.length > 0 || illegalPromises.length > 0) {
    const reasons = [
      ...illegalItems.map(({ it, label }) =>
        `${label} (${civName(it.fromPlayerID)} → ${civName(it.toPlayerID)}): ${it.reasons.join("; ") || "not tradeable"}`
      ),
      ...illegalPromises.map(({ promise, index }) => {
        // The authored promise carries the target the label needs; the inspected term is the fallback
        // when (defensively) the two arrays ever disagree in length.
        const term = symmetricDeal.promises[index] ?? promise;
        const label = formatPromiseLabel(term, { [term.targetPlayerID ?? -1]: civName(term.targetPlayerID ?? -1) });
        return `${label} (${civName(promise.promiserID)} → ${civName(promise.recipientID)}): ${promise.reasons.join("; ") || "not possible"}`;
      }),
    ];
    throw new IllegalDealError(reasons, [
      // The same label the `reasons` line above formats, so the negotiator's Give/Receive
      // reframe (`formatIllegalDealError`) shows the full item, amount included.
      ...illegalItems.map(({ it, label }): IllegalDealTerm => ({
        kind: "item",
        itemType: it.itemType,
        fromPlayerID: it.fromPlayerID,
        toPlayerID: it.toPlayerID,
        reasons: it.reasons,
        label,
      })),
      ...illegalPromises.map(({ promise }): IllegalDealTerm => ({
        kind: "promise",
        promiseType: promise.promiseType,
        promiserID: promise.promiserID,
        recipientID: promise.recipientID,
        ...(promise.targetPlayerID !== undefined ? { targetPlayerID: promise.targetPlayerID } : {}),
        reasons: promise.reasons ?? [],
      })),
    ]);
  }

  const { value1, value2 } = computeValueMaps(inspection, thread.player1ID, thread.player2ID);

  // Stamp the fixed per-type durations AND the referenced entity's display name from the fresh
  // inspection, so the archived deal never carries an author-supplied/missing duration and read
  // surfaces without a live range (the inline deal card, the diplomat/negotiator prompt) can label
  // each item by name instead of a bare `#<id>`. Both come from the same inspection that just valued
  // the deal, so no extra call — durations first, then names off the identical range.
  const storedDeal = stampItemNames(applyDealDurations(symmetricDeal, inspection), inspection);

  const payload = { Deal: storedDeal, Value1: value1, Value2: value2 };

  const stored = await appendRaw(thread, speakerID, messageType, content, payload);
  // Assemble the authoritative committed row from the store's echoed canonical fields (ordered IDs +
  // roles + the server-stamped Turn) plus the payload we just computed. CreatedAt approximates the
  // store's unixepoch (the exact value loads on the next full re-hydrate); display-only.
  const row: DealTranscriptMessage = {
    ID: stored.ID,
    Player1ID: stored.Player1ID,
    Player2ID: stored.Player2ID,
    Player1Role: stored.Player1Role,
    Player2Role: stored.Player2Role,
    SpeakerID: stored.SpeakerID,
    MessageType: messageType,
    Content: stored.Content,
    Payload: payload,
    Turn: stored.Turn,
    CreatedAt: Math.floor(Date.now() / 1000),
  };
  // Report the exact committed row to whichever turn owns this thread, so a proposal the negotiator
  // authors mid-run reaches the client in that turn's terminal rows without a transcript reread. A
  // no-op when no turn is in flight for the thread — including the caller-row commit inside
  // `beginChatTurn`, which runs before the turn registers and is reported to the client separately.
  reportThreadRow(thread, row);
  return { id: stored.ID, turn: stored.Turn, inspection, deal: storedDeal, row };
}

/** The outcome of a `deal-reject`, as decided by the transactional `reject-agent-deal` action. */
export interface DealRejectResult {
  /** Append ID of the rejection row (new, or the existing one on the idempotent path). */
  id: number;
  /** The turn the rejection row carries. */
  turn: number;
  /** The exact durable `deal-reject` row, so callers hydrate their cache without a reread. */
  row: DealTranscriptMessage;
  /** True when THIS call wrote the row; false for the idempotent already-rejected acknowledgement. */
  created: boolean;
}

/**
 * Reject (or retract) a proposal through the transactional mcp-server `reject-agent-deal` action —
 * the sole writer of `deal-reject` (the public `append-message` tool refuses it, a pinned
 * writer-split alongside `deal-accept` / `deal-enacted`).
 *
 * Proposal state belongs to the durable backend (stage 7.04, technical decision 2): the panel, the
 * bridge, and the Express route no longer decide whether a rejection is redundant or stale. One
 * serialized store transaction checks the stored proposal and writes the rejection, so two clients
 * racing to reject — or racing a rejection against an acceptance — cannot both win, and a proposal
 * never carries more than one terminal rejection.
 *
 * Either endpoint may speak it: the counterparty *declining* the offer, or the original proposer
 * *retracting* their own (there is no separate `deal-retract` type, pinned contract).
 *
 * A lost race over proposal state comes back as a structured conflict and is translated here into
 * {@link ProposalConflictError} from the machine-readable `ConflictReason` — never by parsing message
 * text. Caller bugs (wrong pair, non-endpoint speaker) and infrastructure failures still arrive
 * through the MCP error channel and propagate as ordinary errors.
 */
export async function appendDealReject(
  thread: EnvoyThread,
  speakerID: number,
  content: string,
  proposalMessageID: number
): Promise<DealRejectResult> {
  const result = await mcpClient.callTool("reject-agent-deal", {
    PlayerAID: thread.player1ID,
    PlayerBID: thread.player2ID,
    ProposalMessageID: proposalMessageID,
    SpeakerID: speakerID,
    Content: content,
  });
  const outcome = unwrap<{
    Result?: "rejected" | "already-rejected" | "conflict";
    ProposalMessageID?: number;
    AlreadyRejected?: boolean;
    Row?: DealTranscriptMessage;
    ConflictReason?: string;
    ConflictMessage?: string;
  }>(result, "reject-agent-deal");

  if (outcome?.Result === "conflict") {
    throw new ProposalConflictError(
      outcome.ConflictMessage
        ?? `Proposal ${proposalMessageID} can no longer be rejected (${outcome.ConflictReason ?? "conflict"})`
    );
  }
  const row = outcome?.Row;
  if (!row || typeof row.ID !== "number" || typeof row.Turn !== "number") {
    throw new Error("reject-agent-deal did not return the committed deal-reject row");
  }
  // Only a row this call created belongs in the turn's terminal rows: re-reporting an existing
  // rejection would present a redundant acknowledgement as a fresh outcome (and, downstream, post a
  // second notification for an event that already happened).
  const created = outcome.Result === "rejected";
  if (created) reportThreadRow(thread, row);
  return { id: row.ID, turn: row.Turn, row, created };
}

/** The store's echoed canonical row fields, after `append-message` orders the pair (Player1ID = min). */
interface AppendedRow {
  ID: number;
  Player1ID: number;
  Player2ID: number;
  Player1Role: string;
  Player2Role: string;
  SpeakerID: number;
  MessageType: string;
  Content: string;
  Turn: number;
}

/** Shared archival write: one `append-message` row with a Payload, returning the store's echoed row. */
async function appendRaw(
  thread: EnvoyThread,
  speakerID: number,
  messageType: string,
  content: string,
  payload: Record<string, unknown>
): Promise<AppendedRow> {
  const result = await mcpClient.callTool("append-message", {
    PlayerAID: thread.player1ID,
    PlayerBID: thread.player2ID,
    PlayerARole: thread.player1Role,
    PlayerBRole: thread.player2Role,
    SpeakerID: speakerID,
    MessageType: messageType,
    Content: content,
    Payload: payload,
  });
  const row = unwrap<Partial<AppendedRow>>(result, "append-message");
  // A successful append-message echoes the full canonical row; a missing/non-numeric ID or Turn is a
  // store-contract violation, not a value to paper over (the UI references the proposal by ID, and the
  // authoritative row built from this carries the server-stamped Turn).
  if (typeof row?.ID !== "number" || typeof row?.Turn !== "number") {
    throw new Error(`append-message did not return a numeric ID/Turn for ${messageType}`);
  }
  return row as AppendedRow;
}

/**
 * Read the deal-related messages for a conversation's endpoint pair, in append order.
 * The Web reduces these into the latest active proposal client-side (work item 4); the
 * readable text/close messages are hydrated separately for the chat thread.
 */
export async function readDealMessages(playerAID: number, playerBID: number): Promise<DealTranscriptMessage[]> {
  return (await readTranscript(playerAID, playerBID)).filter(isDealMessage);
}

/**
 * Read the conversation's deal messages and reduce them into the latest active proposal +
 * status (work item 4). Used by the diplomat (to see the on-the-table deal), the negotiator
 * loop (to forward it), and the accept route (to find the proposal to enact).
 */
export async function readActiveProposal(playerAID: number, playerBID: number): Promise<DealReduction> {
  const messages = await readDealMessages(playerAID, playerBID);
  return deriveActiveProposal(messages);
}

/**
 * Close a conversation, retracting any still-open proposal first. A pending offer must not outlive
 * the conversation it belongs to — otherwise it stays enactable after the talks ended (and after a
 * later reopen), the root of the "enact on a closed conversation" problem. So we reject the open
 * proposal — authored by whoever closes — BEFORE writing the `close`, leaving nothing to enact.
 *
 * The retract is not swallowed: if it fails, the close fails too, so a conversation is never closed
 * while an open proposal survives. The reverse order can still leave a retracted proposal on an open
 * conversation if the close append fails after it, so callers own that outcome: the Web close control
 * surfaces it as a failed request the human can retry, while a chat turn's staged close logs it and
 * completes the reply. Shared by both so they retract identically.
 *
 * @returns the turn the close was recorded at plus the durable rows this call created, in append
 *          order (the retraction, when there was an open offer, then the close), so the caller
 *          hydrates its live cache — or pushes to the game — without rereading the transcript.
 */
export async function closeConversation(
  thread: EnvoyThread,
  speakerID: number,
  content: string
): Promise<{ turn: number; rows: TranscriptPushMessage[] }> {
  const rows: TranscriptPushMessage[] = [];
  const reduction = await readActiveProposal(thread.player1ID, thread.player2ID);
  if (reduction.active && reduction.status === "open") {
    const retraction = await appendDealReject(
      thread,
      speakerID,
      "The conversation was closed; the open proposal is retracted.",
      reduction.active.ID
    );
    rows.push(retraction.row);
  }
  const closed = await appendCloseMessage(thread, speakerID, content);
  rows.push(closed.row);
  return { turn: closed.turn, rows };
}

/** A validated open proposal plus its canonical stored deal terms. */
export interface OpenProposal {
  message: TranscriptMessage;
  deal: DealPayload;
}

/**
 * Require a specific proposal to still be the open active offer for `responderID`.
 *
 * This is intentionally called immediately before agent terminal writes so a long inspection
 * or LLM turn cannot silently act on a proposal that was countered, rejected, or enacted.
 *
 * Every failure here is a lost race over proposal state — the conversation moved on under the actor —
 * so all of them throw {@link ProposalConflictError} (the 409-class error), never a bare `Error` that
 * a route would have to misclassify as an infrastructure failure. Malformed stored terms are included:
 * from the actor's point of view the offer it saw is simply not actionable.
 *
 * @param options.allowSelfAuthored Permit the proposal's own author to act on it. Accepting your own
 *        offer is meaningless, so accept leaves this off. Rejecting it is a **retraction**, which the
 *        store explicitly allows (either endpoint may speak `deal-reject`), so the reject path turns
 *        it on.
 */
export async function requireCurrentOpenProposal(
  thread: EnvoyThread,
  proposalMessageID: number,
  responderID: number,
  options: { allowSelfAuthored?: boolean } = {}
): Promise<OpenProposal> {
  const reduction = await readActiveProposal(thread.player1ID, thread.player2ID);
  if (!reduction.active || reduction.active.ID !== proposalMessageID) {
    throw new ProposalConflictError(`Proposal ${proposalMessageID} is no longer the active proposal`);
  }
  if (reduction.status !== "open") {
    throw new ProposalConflictError(
      `Proposal ${proposalMessageID} is no longer open (status: ${reduction.status})`
    );
  }
  if (!options.allowSelfAuthored && reduction.active.SpeakerID === responderID) {
    throw new ProposalConflictError(`Player ${responderID} cannot respond to its own proposal`);
  }

  const parsed = DealPayloadSchema.safeParse(
    (reduction.active.Payload as Record<string, unknown> | undefined)?.Deal
  );
  if (!parsed.success) {
    throw new ProposalConflictError(`Proposal ${proposalMessageID} has invalid stored deal terms`);
  }
  return { message: reduction.active, deal: parsed.data };
}

/**
 * Reconcile a streamed deal submission against the live offer state under the turn lock, returning the
 * transcript type it must be archived as. Proposing and countering are the SAME action — submitting a
 * deal — distinguished only by whether an offer is already on the table. The submitter passes the ID of
 * the open offer it saw (`undefined` = it believed none was open); this must match reality:
 *
 *  - matches an active open offer → it answers that offer: archive as `deal-counter`;
 *  - matches "none open"          → it opens a fresh offer: archive as `deal-proposal`;
 *  - mismatch                     → a lost race (an offer opened, was rejected/countered/closed, or
 *                                   changed identity under the submitter): `ProposalConflictError` (→ 409).
 *
 * Validating BOTH directions under the lock is what stops a stale/fresh submission from silently
 * superseding an offer that opened under it, AND a stale counter from reviving a dead negotiation. There
 * is no author check (unlike `requireCurrentOpenProposal`): revising your own standing offer is allowed.
 */
export async function classifyDealSubmission(
  thread: EnvoyThread,
  expectedProposalID: number | undefined
): Promise<DealProposalType> {
  const reduction = await readActiveProposal(thread.player1ID, thread.player2ID);
  const activeOpenID = reduction.active && reduction.status === "open" ? reduction.active.ID : undefined;
  if (activeOpenID !== expectedProposalID) {
    // Phrase the conflict by the submitter's intent: answering a specific offer that has since changed
    // identity / been closed vs. opening a fresh one while an offer it didn't see is already on the table.
    throw new ProposalConflictError(
      expectedProposalID === undefined
        ? `Another proposal (#${activeOpenID}) is now the open offer and must be answered before opening a new one`
        : `Proposal ${expectedProposalID} is no longer the active proposal`
    );
  }
  return activeOpenID === undefined ? "deal-proposal" : "deal-counter";
}

/**
 * Require that no proposal is currently open before an agent authors an opening proposal.
 */
export async function requireNoOpenProposal(thread: EnvoyThread): Promise<void> {
  const reduction = await readActiveProposal(thread.player1ID, thread.player2ID);
  if (reduction.active && reduction.status === "open") {
    throw new Error(`Proposal ${reduction.active.ID} is already open and must be answered first`);
  }
}

/** The result of the enactment route (`enact-agent-deal`). */
export interface EnactDealResult {
  proposalMessageID: number;
  acceptMessageID?: number;
  enactedMessageID: number;
  alreadyEnacted: boolean;
  /** Whether this call enacted the deal in-game (false on the already-enacted idempotent path). */
  enacted: boolean;
  turn?: number;
  /** The durable `deal-accept` row this call wrote (absent on the idempotent path). */
  acceptRow?: DealTranscriptMessage;
  /** The durable `deal-enacted` row — newly written, or the existing one when already enacted. */
  enactedRow?: DealTranscriptMessage;
  /** Exactly the rows THIS call created, in append order. Empty on the idempotent path. */
  rows: DealTranscriptMessage[];
}

/**
 * Enact an agreed deal through the mcp-server `enact-agent-deal` route, the sole writer of
 * `deal-accept` / `deal-enacted` (pinned writer-split). It enacts the deal in-game (transferring
 * the trade items and applying the promise commitments) and records the agreement in the
 * transcript; it is idempotent on the proposal's `deal-enacted` record.
 *
 * Since stage 7.04 the route also reports a **structured conflict** when proposal state refused the
 * enactment — the offer was superseded, already answered, or aimed at the wrong recipient. Those are
 * lost races, so they surface as {@link ProposalConflictError} (409-class) mapped from the
 * machine-readable `Conflict.Reason`, while validation and infrastructure failures still arrive
 * through the MCP error channel and propagate as ordinary errors (502-class). That split is what lets
 * the accept path drop its race-prone catch-time re-probe of the proposal.
 *
 * @param proposalMessageID The deal-proposal / deal-counter being enacted.
 * @param options.accepterID The endpoint accepting (defaults server-side to the recipient).
 * @param options.content    Optional outward line recorded with the acceptance.
 * @param options.thread     The conversation whose in-flight turn should capture the rows this call
 *                           creates. Passed by the shared accept action and the negotiator's accept
 *                           tool; omit it when no turn is observing.
 */
export async function enactAgentDeal(
  proposalMessageID: number,
  options: { accepterID?: number; content?: string; thread?: EnvoyThread } = {}
): Promise<EnactDealResult> {
  const args: Record<string, unknown> = { ProposalMessageID: proposalMessageID };
  if (options.accepterID !== undefined) args.AccepterID = options.accepterID;
  if (options.content !== undefined) args.Content = options.content;
  const result = await mcpClient.callTool("enact-agent-deal", args);
  const row = unwrap<{
    ProposalMessageID?: number;
    AcceptMessageID?: number;
    EnactedMessageID?: number;
    AlreadyEnacted?: boolean;
    Enacted?: boolean;
    Turn?: number;
    AcceptRow?: DealTranscriptMessage;
    EnactedRow?: DealTranscriptMessage;
    Conflict?: { Reason?: string; Message?: string };
  }>(result, "enact-agent-deal");
  if (row?.Conflict) {
    throw new ProposalConflictError(
      row.Conflict.Message
        ?? `Proposal ${proposalMessageID} can no longer be accepted (${row.Conflict.Reason ?? "conflict"})`
    );
  }
  if (typeof row?.EnactedMessageID !== "number") {
    throw new Error("enact-agent-deal did not return a numeric EnactedMessageID");
  }
  // The idempotent path returns the EXISTING enacted row and wrote nothing, so it contributes no
  // rows: an acknowledgement must not be reported as a fresh state transition.
  const rows = row.AlreadyEnacted
    ? []
    : [row.AcceptRow, row.EnactedRow].filter((entry): entry is DealTranscriptMessage => !!entry);
  reportThreadRows(options.thread, rows);
  return {
    proposalMessageID: row.ProposalMessageID ?? proposalMessageID,
    acceptMessageID: typeof row.AcceptMessageID === "number" ? row.AcceptMessageID : undefined,
    enactedMessageID: row.EnactedMessageID,
    alreadyEnacted: !!row.AlreadyEnacted,
    enacted: !!row.Enacted,
    turn: typeof row.Turn === "number" ? row.Turn : undefined,
    acceptRow: row.AcceptRow,
    enactedRow: row.EnactedRow,
    rows,
  };
}
