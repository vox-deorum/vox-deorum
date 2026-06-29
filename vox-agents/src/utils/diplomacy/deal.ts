/**
 * @module utils/diplomacy/deal
 *
 * Deal-action I/O between the Web deal screen (interactive-diplomacy stage 4) and the
 * mcp-server: read-only `inspect-deal` inspection plus the typed deal-action transcript
 * writes (`deal-proposal` / `deal-counter` / `deal-reject`) through `append-message`.
 *
 * These are the structured deal endpoints — explicitly NOT the plain-text
 * `/api/agents/message` path. Each write is archival only (specs §6): `append-message`
 * archives the transcript row; it never streams, notifies, runs agents, or enacts.
 *
 * Stage-4 boundaries (preview mode):
 *  - proposal / counter / reject round-trip through the durable store here;
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
import { hydrateDealRow } from "./transcript-utils.js";
import { appendCloseMessage, readTranscript } from "./transcript.js";
import { createLogger } from "../logger.js";
import { deriveActiveProposal, type DealReduction } from "./deal-reduce.js";
// Pinned deal contract — the single source of truth shared across stages 4–6.
import {
  DealPayloadSchema,
  applyDealDurations,
  symmetrizeDeal,
  TARGETED_PROMISE_TYPES,
  isDealMessage,
  type DealPayload,
  type DealTranscriptMessage,
  type PerItemValueMap,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
import type {
  NormalizedSideRange,
  PromiseTargetInfo,
} from "../../../../mcp-server/dist/tools/knowledge/inspect-deal.js";

const logger = createLogger("diplomacy:deal");

/**
 * Thrown when a deal carries a trade item the game reports as untradeable. This is a client/agent
 * error (a bad proposal), distinct from a bridge/store failure, so callers can map it to a 4xx
 * (UI) or relay the per-item reasons back to the model (negotiator) instead of treating it as 5xx.
 */
export class IllegalDealError extends Error {
  /** One line per illegal trade item: "ITEM_TYPE (from→to): reason". */
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`Deal contains untradeable items: ${reasons.join("; ")}`);
    this.name = "IllegalDealError";
    this.reasons = reasons;
  }
}

/** Deal message types that carry proposed terms in Payload.Deal. */
export type DealProposalType = "deal-proposal" | "deal-counter";

/** One inspected trade term as `inspect-deal` returns it (index-aligned with the proposed items). */
export interface InspectedTradeItem {
  fromPlayerID: number;
  toPlayerID: number;
  itemType: string;
  legality: boolean;
  reasons: string[];
  valueIfIGive: number;
  valueIfIReceive: number;
}

/** One inspected promise term as `inspect-deal` returns it (index-aligned with promises). */
export interface InspectedPromise {
  promiserID: number;
  recipientID: number;
  promiseType: string;
  targetPlayerID?: number;
  duration?: number;
  agreeabilityFactors?: {
    promiserOpinionOfRecipient?: string[];
    recipientOpinionOfPromiser?: string[];
    recentDiplomaticEvents?: unknown;
    note?: string;
    [key: string]: unknown;
  };
}

/** The full `inspect-deal` result for a pair + (optional) proposed deal. */
export interface InspectDealResult {
  items: InspectedTradeItem[];
  promises: InspectedPromise[];
  /** Per side (keyed by player ID as string): the full tradable range it could put on the table. */
  tradableRange: Record<string, NormalizedSideRange>;
  /** The game's standard deal duration in turns (Game.GetDealDuration); used to stamp duration-bearing terms. */
  defaultDuration?: number;
  /** The game's peace-deal duration in turns (Game.GetPeaceDuration); used for peace / third-party-peace terms. */
  peaceDuration?: number;
  /** The game's relationship duration in turns (Game.GetRelationshipDuration); used for Declaration of Friendship. */
  relationshipDuration?: number;
  /** Military promise binding window in turns (flat). */
  militaryPromiseDuration?: number;
  /** Expansion promise binding window in turns (game-speed scaled). */
  expansionPromiseDuration?: number;
  /** Border promise binding window in turns (game-speed scaled). */
  borderPromiseDuration?: number;
  /** Coop War preparation countdown in turns before the joint war auto-declares. */
  coopWarPromiseDuration?: number;
  /** Eligible third-party promise targets (Coop War majors) with display names. */
  promiseTargets?: PromiseTargetInfo[];
}

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
  for (const [index, item] of deal.items.entries()) {
    if (!isConversationDirection(item.fromPlayerID, item.toPlayerID, thread.player1ID, thread.player2ID)) {
      throw new Error(`deal.items[${index}] must be directed between the conversation endpoints`);
    }
  }

  for (const [index, promise] of deal.promises.entries()) {
    if (!isConversationDirection(promise.promiserID, promise.recipientID, thread.player1ID, thread.player2ID)) {
      throw new Error(`deal.promises[${index}] must be directed between the conversation endpoints`);
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
        throw new Error(`deal.promises[${index}] with type ${promise.promiseType} requires a third-party targetPlayerID`);
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
 * Append a `deal-proposal` / `deal-counter` to the durable store, computing and attaching
 * the proposal-time per-item value snapshots from a fresh inspection before the archival
 * write. The speaker is the endpoint authoring the move (the human/caller in stage-4
 * preview).
 *
 * Durations are not author-supplied (specs §3): before archival the deal is normalized via
 * `applyDealDurations`, stamping each duration-bearing item's fixed game duration (deal / peace /
 * relationship, by type) from the fresh inspection. So the stored `Payload.Deal` always carries the
 * right durations, whether it came from the Web editor or an agent that proposed none.
 *
 * @returns the stored row's append ID and server-stamped turn (the values `read-transcript`
 *          will later report), plus the proposal-time inspection when available so an agent
 *          caller can immediately brief the diplomat without re-reading or re-inspecting, and the
 *          canonical (duration-stamped) deal exactly as it was archived.
 */
export async function appendDealProposal(
  thread: EnvoyThread,
  speakerID: number,
  messageType: DealProposalType,
  content: string,
  deal: DealPayload
): Promise<{ id: number; turn?: number; inspection?: InspectDealResult; deal: DealPayload }> {
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
  // rejected here, for both the UI and the negotiator paths that share this function.
  const illegal = inspection.items.filter((it) => !it.legality);
  if (illegal.length > 0) {
    throw new IllegalDealError(
      illegal.map(
        (it) => `${it.itemType} (${it.fromPlayerID}→${it.toPlayerID}): ${it.reasons.join("; ") || "not tradeable"}`
      )
    );
  }

  const { value1, value2 } = computeValueMaps(inspection, thread.player1ID, thread.player2ID);

  // Stamp the fixed per-type durations from the fresh inspection so the archived deal never carries
  // an author-supplied or missing duration (the durations match what the inspection just valued).
  const storedDeal = applyDealDurations(symmetricDeal, inspection);

  const payload: Record<string, unknown> = { Deal: storedDeal };
  payload.Value1 = value1;
  payload.Value2 = value2;

  const stored = await appendRaw(thread, speakerID, messageType, content, payload);
  return { ...stored, inspection, deal: storedDeal };
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
  return appendRaw(thread, speakerID, "deal-reject", content, { ProposalMessageID: proposalMessageID });
}

/** Shared archival write: one `append-message` row with a Payload, returning its id + turn. */
async function appendRaw(
  thread: EnvoyThread,
  speakerID: number,
  messageType: string,
  content: string,
  payload: Record<string, unknown>
): Promise<{ id: number; turn?: number }> {
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
  const row = unwrap<{ ID?: unknown; Turn?: unknown }>(result);
  // A successful append-message must echo a numeric row ID — the UI references the proposal by
  // it. A missing/non-numeric ID is a store-contract violation, not a value to paper over.
  if (typeof row?.ID !== "number") {
    throw new Error(`append-message did not return a numeric ID for ${messageType}`);
  }
  return {
    id: row.ID,
    turn: typeof row?.Turn === "number" ? row.Turn : undefined,
  };
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
 * Require that no proposal is currently open before an agent authors an opening proposal.
 */
export async function requireNoOpenProposal(thread: EnvoyThread): Promise<void> {
  const reduction = await readActiveProposal(thread.player1ID, thread.player2ID);
  if (reduction.active && reduction.status === "open") {
    throw new Error(`Proposal ${reduction.active.ID} is already open and must be answered first`);
  }
}

/** The result of the (stage-5 stub) enactment route. */
export interface EnactDealResult {
  proposalMessageID: number;
  acceptMessageID?: number;
  enactedMessageID: number;
  alreadyEnacted: boolean;
  /** Whether in-game effects were applied (always false in the stage-5 stub). */
  enacted: boolean;
  turn?: number;
}

/**
 * Enact an agreed deal through the mcp-server `enact-agent-deal` route — the sole writer of
 * `deal-accept` / `deal-enacted` (pinned writer-split). In stage 5 this records the agreement
 * in the transcript without applying in-game effects (the DLL entrypoint lands in stage 6);
 * it is idempotent on the proposal's `deal-enacted` record.
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
