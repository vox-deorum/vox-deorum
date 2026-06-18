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
 * are computed here from a fresh `inspect-deal` at proposal time, so the stored snapshot
 * reflects the live `GetTradeItemValue` of each item to each ordered player. The trade
 * screen's other-side total balance is summed from these on the client — never stored as a
 * precomputed total (specs §3, deal-schema PerItemValueMap).
 */

import type { EnvoyThread } from "../../types/index.js";
import { mcpClient } from "../models/mcp-client.js";
import type { TranscriptMessage } from "./transcript-utils.js";
import { createLogger } from "../logger.js";
// Pinned deal contract — the single source of truth shared across stages 4–6.
import type { DealPayload, PerItemValueMap } from "../../../../mcp-server/dist/utils/deal-schema.js";

const logger = createLogger("diplomacy:deal");

/** Promise types whose meaning requires a third-party target. */
const TARGETED_PROMISE_TYPES = new Set(["COOP_WAR", "BULLY_CITY_STATE", "ATTACK_CITY_STATE"]);

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

/** The full `inspect-deal` result for a pair + (optional) proposed deal. */
export interface InspectDealResult {
  items: InspectedTradeItem[];
  promises: unknown[];
  /** Per side (keyed by player ID as string): the full tradable range it could put on the table. */
  tradableRange: Record<string, unknown>;
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
 * agreeability factors. Everything is advisory — it gates nothing (specs §4).
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
 * the proposal-time per-item value snapshots from a fresh inspection. The speaker is the
 * endpoint authoring the move (the human/caller in stage-4 preview).
 *
 * @returns the stored row's append ID and server-stamped turn (the values `read-transcript`
 *          will later report), so the UI can reference this proposal without re-reading.
 */
export async function appendDealProposal(
  thread: EnvoyThread,
  speakerID: number,
  messageType: DealProposalType,
  content: string,
  deal: DealPayload
): Promise<{ id: number; turn?: number }> {
  // Transcript-shape validation is not best-effort: malformed terms must never be archived.
  validateDealForThread(thread, deal);

  // Best-effort value snapshot: a fresh inspection at proposal time (specs §3). If the game
  // can't be inspected right now we still archive the proposal — the value maps are optional.
  let value1: PerItemValueMap | undefined;
  let value2: PerItemValueMap | undefined;
  try {
    const inspection = await inspectDeal(thread.player1ID, thread.player2ID, deal);
    ({ value1, value2 } = computeValueMaps(inspection, thread.player1ID, thread.player2ID));
  } catch (error) {
    logger.warn("Could not compute proposal-time value snapshots; archiving without them", { error });
  }

  const payload: Record<string, unknown> = { Deal: deal };
  if (value1) payload.Value1 = value1;
  if (value2) payload.Value2 = value2;

  return appendRaw(thread, speakerID, messageType, content, payload);
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

/** Message types that participate in deal reduction (proposal/counter/response/enacted). */
const DEAL_MESSAGE_TYPES = new Set([
  "deal-proposal",
  "deal-counter",
  "deal-accept",
  "deal-reject",
  "deal-enacted",
]);

/**
 * Read the deal-related messages for a conversation's endpoint pair, in append order.
 * The Web reduces these into the latest active proposal client-side (work item 4); the
 * readable text/close messages are hydrated separately for the chat thread.
 */
export async function readDealMessages(playerAID: number, playerBID: number): Promise<TranscriptMessage[]> {
  const result = await mcpClient.callTool("read-transcript", { PlayerAID: playerAID, PlayerBID: playerBID });
  const arr = unwrap<unknown>(result);
  if (!Array.isArray(arr)) return [];
  return (arr as TranscriptMessage[]).filter((m) => DEAL_MESSAGE_TYPES.has(m.MessageType));
}
