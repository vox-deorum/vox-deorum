/**
 * @module envoy/utils/diplomat-utils
 *
 * The live deal context the diplomat sees on every step (interactive-diplomacy stage 5).
 * The diplomat NEVER authors deal terms — it hands the conversational context to its negotiator
 * through the `call-negotiator` agent-tool and voices the negotiator's move out. This module only
 * renders the active proposal and the currently possible legal deal items into the diplomat's model
 * context so it can discuss negotiations faithfully without authoring or deciding terms.
 */

import type { EnvoyThread } from "../../types/index.js";
import type { DealReduction } from "../../utils/diplomacy/deal-reduce.js";
import { inspectDeal, type InspectDealResult } from "../../utils/diplomacy/deal.js";
import { createLogger } from "../../utils/logger.js";
import { identityOf } from "../../utils/diplomacy/transcript-utils.js";
import {
  DealPayloadSchema,
  type DealTranscriptMessage,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
import { formatDealTermsByDirection } from "../../../../mcp-server/dist/utils/deal-format.js";
import type { PlayersReport } from "../../../../mcp-server/dist/tools/knowledge/get-players.js";
import {
  formatDealLedger,
  type DealLedgerContext,
  type RelationshipDirectives,
} from "./deal-ledger.js";
import { formatGiveReceiveLedger } from "./give-receive-menu.js";

const logger = createLogger("diplomat-deal");

/** Optional grounding folded into the diplomat's deal view (all from a fresh open-deal inspection / game state). */
export interface DealContextOptions {
  inspection?: InspectDealResult;
  players?: PlayersReport;
  relationships?: RelationshipDirectives;
}

/** The diplomat's rendered live deal context and the proposal actually emitted as open. */
export interface DiplomatDealContext {
  text: string;
  openProposalID?: number;
}

/** Format possible items only when the inspection has complete endpoint ranges. */
function formatPossibleDealItems(
  inspection: InspectDealResult | undefined,
  thread: EnvoyThread,
  players?: PlayersReport
): string {
  const hasCompleteTradableRange = Boolean(
    inspection?.tradableRange?.[String(thread.player1ID)] &&
    inspection?.tradableRange?.[String(thread.player2ID)]
  );
  if (!inspection || !hasCompleteTradableRange) return "(options unavailable)";

  try {
    return formatGiveReceiveLedger(inspection, thread, players, { presentation: "diplomat" });
  } catch (error) {
    logger.warn("Could not format possible deal items for diplomat context", { error });
    return "(options unavailable)";
  }
}

/**
 * Format the on-the-table deal the diplomat must "see at every step": the active proposal's terms
 * (via the shared unified ledger: direction-grouped with civ names, advisory per-item value estimates,
 * and third-party relationship context), the deal's one-sentence message, the negotiator's inward
 * `rationale` (only for a proposal authored by the diplomat's own seat), and the proposal's current
 * status. `civName` resolves a seat's civ name (defaults to "Player <id>"). Returns undefined when no
 * deal is active.
 */
export function formatDealContext(
  reduction: DealReduction,
  viewerID: number,
  civName?: (playerID: number) => string,
  options?: DealContextOptions
): string | undefined {
  const active = reduction.active;
  if (!active) return undefined;

  const payload = (active.Payload ?? {}) as Record<string, unknown>;
  const parsedDeal = DealPayloadSchema.safeParse(payload.Deal);
  if (!parsedDeal.success) return undefined;
  const deal = parsedDeal.data;

  const resolveName = civName ?? ((id: number) => `Player ${id}`);
  const counterpartID = active.Player1ID === viewerID ? active.Player2ID : active.Player1ID;
  const ctx: DealLedgerContext = { viewerID, counterpartID, civName: resolveName };
  const ownAuthored = active.SpeakerID === viewerID;

  // The message is hoisted to a speaker-aware block under the heading; a deal our own seat authored also
  // surfaces the negotiator's private rationale (never the counterpart's; that stays hidden).
  const messageLines: string[] = [];
  if (deal.message) {
    messageLines.push(ownAuthored ? "## Our Negotiator's Message" : "## Their Message", `> ${deal.message}`);
  }
  if (ownAuthored && deal.rationale) {
    messageLines.push(`> Rationale (for you, do not quote): ${deal.rationale}`);
  }

  const heading = `# Deal On The Table (#${active.ID}, ${active.MessageType}, status: ${reduction.status})`;
  const ledger = formatDealLedger(deal, heading, ctx, {
    inspection: options?.inspection,
    players: options?.players,
    relationships: options?.relationships,
    messageBlock: messageLines.length ? messageLines.join("\n") : undefined,
  });

  const blocks = [ledger];
  if (reduction.status === "open") {
    // This block lands right before the always-last turn hint, and the author is known here — so
    // state the open-deal ask directly instead of leaving the model an if-else.
    blocks.push(
      ownAuthored
        ? "Your proposal awaits the counterpart's reply. Do not call the negotiator again until they respond."
        : "The counterpart's deal is on the table. Hand it to the negotiator by calling `call-negotiator` with a `Briefing` of the conversation so far. The negotiator decides whether to accept, counter, or reject."
    );
  }
  return blocks.join("\n\n");
}

/**
 * Compose the diplomat's live deal context from one fresh inspection. The currently possible deal items
 * are always included. When an open proposal exists, that same inspection includes the proposed deal and
 * supplies its advisory values. The returned proposal ID is present only when its on-the-table block was
 * actually emitted, so the inline transcript renderer cannot point at a missing block.
 */
export async function buildDealContextMessage(
  thread: EnvoyThread,
  reduction: DealReduction,
  players?: PlayersReport,
  relationships?: RelationshipDirectives
): Promise<DiplomatDealContext> {
  const candidateDeal = (reduction.active?.Payload as Record<string, unknown> | undefined)?.Deal;
  const parsedOpenDeal = reduction.status === "open" ? DealPayloadSchema.safeParse(candidateDeal) : undefined;
  const openDeal = parsedOpenDeal?.success ? parsedOpenDeal.data : undefined;
  let inspection: InspectDealResult | undefined;
  try {
    inspection = await inspectDeal(thread.player1ID, thread.player2ID, openDeal);
  } catch (error) {
    logger.warn("Could not inspect possible deal items for diplomat context", { error });
  }

  const civName = (id: number): string => identityOf(thread, id)?.name ?? `Player ${id}`;
  const dealContext = openDeal
    ? formatDealContext(reduction, thread.agent, civName, {
        inspection,
        players,
        relationships,
      })
    : undefined;
  const blocks: string[] = [];
  if (dealContext) blocks.push(dealContext);
  blocks.push("# Possible Deal Items\n" + formatPossibleDealItems(inspection, thread, players));

  return {
    text: blocks.join("\n\n"),
    openProposalID: dealContext ? reduction.active?.ID : undefined,
  };
}

/**
 * Render one deal transcript row as the inline conversation line the diplomat reads in its chat
 * record. A `deal-proposal` / `deal-counter` shows its outward message (when any) plus its terms —
 * direction-grouped, viewer-first, terms only. But when the row IS the currently-open proposal
 * (`row.ID === openProposalID`), the terms are omitted and it points at the "Deal On The Table" block
 * instead — that block already carries the full terms, advisory values, and the action ask, so
 * repeating them here would be redundant. A `deal-reject` / `deal-accept` / `deal-enacted` prefixes
 * its outward line with the proposal it answers (by ID), so a bare "We will not accept this proposal."
 * reads as which deal it settled. Returns the replacement Content (the caller adds the `[Turn N]`
 * prefix), or undefined to leave the row's stored Content untouched.
 */
export function renderDealRowInline(
  row: DealTranscriptMessage,
  thread: EnvoyThread,
  openProposalID?: number
): string | undefined {
  const civName = (id: number): string => identityOf(thread, id)?.name ?? `Player ${id}`;
  const answeredID = row.Payload.ProposalMessageID;
  const line = row.Content?.trim();

  switch (row.MessageType) {
    case "deal-proposal":
    case "deal-counter": {
      const parsedDeal = DealPayloadSchema.safeParse(row.Payload.Deal);
      if (!parsedDeal.success) return undefined;
      const deal = parsedDeal.data;
      const verb = row.MessageType === "deal-counter" ? "countered" : "proposed";
      const message = deal.message?.trim();
      const header = message
        ? `A deal was ${verb} (#${row.ID}): ${message}`
        : `A deal was ${verb} (#${row.ID}).`;
      // The still-open proposal is rendered in full — terms, advisory values, action ask — in the
      // "Deal On The Table" block, so point at it instead of repeating the terms here. Only a
      // superseded/closed proposal (never back on the table) shows its terms inline.
      if (openProposalID !== undefined && row.ID === openProposalID) {
        return `${header} (its full terms are in "Deal On The Table" below)`;
      }
      // Terms only (no value snapshots): the advisory per-item values belong to the on-the-table
      // block, not every historical proposal line.
      const terms = formatDealTermsByDirection(
        deal, undefined, undefined, thread.player1ID, thread.player2ID, civName, thread.agent
      );
      return terms ? `${header}\n${terms}` : header;
    }
    case "deal-reject":
      return answeredRef("Rejected", answeredID, line || "The deal was rejected.");
    case "deal-accept":
      return answeredRef("Accepted", answeredID, line || "The deal was accepted.");
    case "deal-enacted":
      return answeredRef("Enacted", answeredID, line || "The deal was enacted.");
    default:
      return undefined;
  }
}

/** "<Verb> deal #<id> — <line>" (drops "#<id>" when the answered proposal ID is absent). */
function answeredRef(verb: string, answeredID: number | undefined, line: string): string {
  return answeredID !== undefined ? `${verb} deal #${answeredID} — ${line}` : `${verb} deal — ${line}`;
}
