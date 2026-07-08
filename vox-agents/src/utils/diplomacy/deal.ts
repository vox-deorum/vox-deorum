/**
 * @module utils/diplomacy/deal
 *
 * Deal-action I/O between the Web deal screen (interactive-diplomacy stage 4) and the
 * mcp-server: read-only `inspect-deal` inspection plus the typed deal-action transcript
 * writes (`deal-proposal` / `deal-counter` / `deal-reject`) through `append-message`.
 *
 * Each write here is archival only (specs §6): `append-message` archives the transcript row; it
 * never streams, notifies, runs agents, or enacts. The CALLERS differ by action, though:
 *  - proposal / counter are a single "submit a deal" action that commits as the turn's commit point
 *    through the unified streaming `/api/agents/message` path (so the diplomat's reply streams after);
 *    `appendDealProposal` is the shared chokepoint both that path and the negotiator's tool use, and
 *    `classifyDealSubmission` reconciles the submission against the live offer state under the turn lock;
 *  - reject is a blocking status write (the typed `/deal/reject` route, and the diplomat's reject tool);
 *  - `deal-accept` is NOT written here — acceptance goes through the enactment route
 *    (`enact-agent-deal`, stage 6), the only writer of `deal-accept` / `deal-enacted`
 *    (pinned contract). The accept endpoint is wired in stage 4 but deferred.
 *
 * The per-item value snapshots stored on a proposal (`Payload.Value1` / `Payload.Value2`)
 * are computed here from a fresh `inspect-deal` before archival, so the stored snapshot
 * reflects the live `GetTradeItemValue` of each item to each ordered player. The trade
 * screen's other-side total balance is summed from these on the client — never stored as a
 * precomputed total (specs §3, deal-schema PerItemValueMap).
 */

import type { EnvoyThread } from "../../types/index.js";
import { mcpClient } from "../models/mcp-client.js";
import type { TranscriptMessage } from "./transcript-utils.js";
import { hydrateDealRow, identityOf } from "./transcript-utils.js";
import { appendCloseMessage, readTranscript } from "./transcript.js";
import { createLogger } from "../logger.js";
import { deriveActiveProposal, type DealReduction } from "./deal-reduce.js";
// Pinned deal contract — the single source of truth shared across stages 4–6.
import {
  DealPayloadSchema,
  applyDealDurations,
  resolveItemName,
  symmetrizeDeal,
  TARGETED_PROMISE_TYPES,
  isDealMessage,
  type DealPayload,
  type DealTranscriptMessage,
  type PerItemValueMap,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
// Friendly, game-facing labels for illegal-item error lines (single source of truth in mcp-server).
import { formatItemLabel, itemTypeLabel } from "../../../../mcp-server/dist/utils/deal-format.js";
import type {
  InspectDealResponse,
} from "../../../../mcp-server/dist/tools/knowledge/inspect-deal.js";

const logger = createLogger("diplomacy:deal");

/** One untradeable trade item, structured so programmatic consumers (the negotiator's Give/Take
 *  reframe) never have to parse the human-readable reason strings. */
export interface IllegalTradeItem {
  itemType: string;
  fromPlayerID: number;
  toPlayerID: number;
  reasons: string[];
}

/**
 * Thrown when a deal carries a trade item the game reports as untradeable. This is a client/agent
 * error (a bad proposal), distinct from a bridge/store failure, so callers can map it to a 4xx
 * (UI) or relay the per-item reasons back to the model (negotiator) instead of treating it as 5xx.
 */
export class IllegalDealError extends Error {
  /** Human-readable display lines, one per illegal trade item ("<friendly label> (<giver> → <receiver>): reason").
   *  The joined form is the error message; the UI toast shows it verbatim. */
  readonly reasons: string[];
  /** Structured per-item detail for programmatic consumers (empty for structural validation errors,
   *  which carry no trade item — the negotiator then relays `reasons` verbatim). */
  readonly details: IllegalTradeItem[];
  constructor(reasons: string[], details: IllegalTradeItem[] = []) {
    super(`Deal contains untradeable items: ${reasons.join("; ")}`);
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

/** Unwrap the structured tool result (mcp tool results wrap the value under structuredContent). */
function unwrap<T>(result: unknown): T {
  const raw = result as Record<string, unknown>;
  return (raw?.structuredContent ?? raw) as T;
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
  return unwrap<InspectDealResult>(result);
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
  const symmetricDeal = symmetrizeDeal(deal);

  // Transcript-shape validation is not best-effort: malformed terms must never be archived.
  validateDealForThread(thread, symmetricDeal);

  // Required value/agreement snapshot: if the game can't inspect this proposal right now,
  // do not archive a deal the diplomat/negotiator cannot evaluate faithfully.
  let inspection: InspectDealResult;
  try {
    inspection = await inspectDeal(thread.player1ID, thread.player2ID, symmetricDeal);
  } catch (error) {
    logger.error("Could not inspect proposal before archival", { error });
    throw new Error(
      `Could not inspect deal before storing proposal: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  // Hard legality guard: a proposal carrying any untradeable trade item must never be archived.
  // The same per-term legality that drives the board's red rows now gates the write — so a hidden
  // category (bonus resource, ruleset-disabled RA/tech/vassalage) or any pairing-illegal term is
  // rejected here, for both the UI and the negotiator paths that share this function. The inspected
  // items are index-aligned with `symmetricDeal.items`, so the full TradeItem (for a friendly,
  // data-bearing label) is available by index; civ names come from the thread's stored identities.
  const civName = (id: number): string => identityOf(thread, id)?.name ?? `Player ${id}`;
  const illegal = inspection.items.map((it, index) => ({ it, index })).filter(({ it }) => !it.legality);
  if (illegal.length > 0) {
    throw new IllegalDealError(
      illegal.map(({ it, index }) => {
        const item = symmetricDeal.items[index];
        const label = item ? formatItemLabel(item) : itemTypeLabel(it.itemType);
        return `${label} (${civName(it.fromPlayerID)} → ${civName(it.toPlayerID)}): ${it.reasons.join("; ") || "not tradeable"}`;
      }),
      illegal.map(({ it }) => ({
        itemType: it.itemType,
        fromPlayerID: it.fromPlayerID,
        toPlayerID: it.toPlayerID,
        reasons: it.reasons,
      }))
    );
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
  return { id: stored.ID, turn: stored.Turn, inspection, deal: storedDeal, row };
}

/**
 * Append a `deal-reject` answering an earlier proposal/counter. Either endpoint may speak
 * it — the counterparty declining, or the original proposer retracting their own offer
 * (there is no separate `deal-retract` type, pinned contract).
 */
export async function appendDealReject(
  thread: EnvoyThread,
  speakerID: number,
  content: string,
  proposalMessageID: number
): Promise<{ id: number; turn?: number }> {
  const stored = await appendRaw(thread, speakerID, "deal-reject", content, { ProposalMessageID: proposalMessageID });
  return { id: stored.ID, turn: stored.Turn };
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
  const row = unwrap<Partial<AppendedRow>>(result);
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
 * Mirror any durable deal rows not yet in the live cache into `thread.messages`, in append order,
 * WITHOUT disturbing existing rows — so a deal status write (accept/reject, or the close-time
 * retract) is reflected while the conversation's live reasoning/tool-call traces are preserved (no
 * full re-hydrate). Deduped by stored row ID; the new rows are the newest events, so end-append
 * keeps order. The accept-mid-conversation counterpart of `syncThreadMessages` (which re-hydrates
 * the whole thread on entry).
 */
export async function reconcileDealRows(thread: EnvoyThread): Promise<void> {
  const rows = await readDealMessages(thread.player1ID, thread.player2ID);
  const present = new Set(thread.messages.flatMap((m) => (m.deal ? [m.deal.ID] : [])));
  for (const row of rows) {
    if (!present.has(row.ID)) thread.messages.push(hydrateDealRow(row, thread.agent));
  }
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
 * while an open proposal survives (the caller's existing error handling retries). Shared by the Web
 * close control and the diplomat's close-conversation tool so both paths retract identically.
 *
 * @returns the turn the close was recorded at.
 */
export async function closeConversation(
  thread: EnvoyThread,
  speakerID: number,
  content: string,
  fallbackTurn: number
): Promise<number> {
  const reduction = await readActiveProposal(thread.player1ID, thread.player2ID);
  if (reduction.active && reduction.status === "open") {
    await appendDealReject(
      thread,
      speakerID,
      "The conversation was closed; the open proposal is retracted.",
      reduction.active.ID
    );
  }
  return appendCloseMessage(thread, speakerID, content, fallbackTurn);
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
 */
export async function requireCurrentOpenProposal(
  thread: EnvoyThread,
  proposalMessageID: number,
  responderID: number
): Promise<OpenProposal> {
  const reduction = await readActiveProposal(thread.player1ID, thread.player2ID);
  if (!reduction.active || reduction.active.ID !== proposalMessageID) {
    throw new Error(`Proposal ${proposalMessageID} is no longer the active proposal`);
  }
  if (reduction.status !== "open") {
    throw new Error(`Proposal ${proposalMessageID} is no longer open (status: ${reduction.status})`);
  }
  if (reduction.active.SpeakerID === responderID) {
    throw new Error(`Player ${responderID} cannot respond to its own proposal`);
  }

  const parsed = DealPayloadSchema.safeParse(
    (reduction.active.Payload as Record<string, unknown> | undefined)?.Deal
  );
  if (!parsed.success) {
    throw new Error(`Proposal ${proposalMessageID} has invalid stored deal terms`);
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
}

/**
 * Enact an agreed deal through the mcp-server `enact-agent-deal` route, the sole writer of
 * `deal-accept` / `deal-enacted` (pinned writer-split). It enacts the deal in-game (transferring
 * the trade items and applying the promise commitments) and records the agreement in the
 * transcript; it is idempotent on the proposal's `deal-enacted` record.
 *
 * @param proposalMessageID The deal-proposal / deal-counter being enacted.
 * @param options.accepterID The endpoint accepting (defaults server-side to the recipient).
 * @param options.content    Optional outward line recorded with the acceptance.
 */
export async function enactAgentDeal(
  proposalMessageID: number,
  options: { accepterID?: number; content?: string } = {}
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
  }>(result);
  if (typeof row?.EnactedMessageID !== "number") {
    throw new Error("enact-agent-deal did not return a numeric EnactedMessageID");
  }
  return {
    proposalMessageID: row.ProposalMessageID ?? proposalMessageID,
    acceptMessageID: typeof row.AcceptMessageID === "number" ? row.AcceptMessageID : undefined,
    enactedMessageID: row.EnactedMessageID,
    alreadyEnacted: !!row.AlreadyEnacted,
    enacted: !!row.Enacted,
    turn: typeof row.Turn === "number" ? row.Turn : undefined,
  };
}
