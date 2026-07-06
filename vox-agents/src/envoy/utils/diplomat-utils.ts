/**
 * @module envoy/utils/diplomat-utils
 *
 * The on-the-table deal context the diplomat sees on every step (interactive-diplomacy stage 5).
 * The diplomat NEVER authors deal terms — it hands the conversational context to its negotiator
 * through the `call-negotiator` agent-tool and voices the negotiator's move out. This module only
 * renders the active proposal (terms, the negotiator's rationale/message, advisory per-item value
 * estimates, third-party relationship context, and status) into the diplomat's model context via the
 * shared {@link formatDealLedger} so it can voice each move faithfully.
 */

import type { EnvoyThread } from "../../types/index.js";
import type { DealReduction } from "../../utils/diplomacy/deal-reduce.js";
import { inspectDeal, type InspectDealResult } from "../../utils/diplomacy/deal.js";
import { createLogger } from "../../utils/logger.js";
import { identityOf } from "../../utils/diplomacy/transcript-utils.js";
import type { DealPayload, DealTranscriptMessage } from "../../../../mcp-server/dist/utils/deal-schema.js";
import { formatDealTermsByDirection } from "../../../../mcp-server/dist/utils/deal-format.js";
import type { PlayersReport } from "../../../../mcp-server/dist/tools/knowledge/get-players.js";
import {
  formatDealLedger,
  type DealLedgerContext,
  type RelationshipDirectives,
} from "./deal-ledger.js";

const logger = createLogger("diplomat-deal");

/** Optional grounding folded into the diplomat's deal view (all from a fresh open-deal inspection / game state). */
export interface DealContextOptions {
  inspection?: InspectDealResult;
  players?: PlayersReport;
  relationships?: RelationshipDirectives;
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
  const deal = payload.Deal as DealPayload | undefined;
  if (!deal) return undefined;

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
 * Format the on-the-table deal block for the diplomat's model input from an already-computed durable
 * reduction — ONLY for a genuinely OPEN deal (the actionable one), inspected fresh for per-term value
 * + third-party context. A rejected/accepted/enacted deal is NOT rendered here: it is shown inline in
 * the diplomat's chat record at its proposal turn (see {@link renderDealRowInline}), so it no longer
 * masquerades as a "Deal On The Table". The caller passes the SAME reduction it uses to pick the
 * inline renderer's open-proposal pointer, so the block and that pointer can never disagree about
 * which proposal is open. `players`/`relationships` (from the caller's already-fetched game state)
 * supply the third-party relationship lines. Returns undefined when no deal is open on the table.
 */
export async function buildDealContextMessage(
  thread: EnvoyThread,
  reduction: DealReduction,
  players?: PlayersReport,
  relationships?: RelationshipDirectives
): Promise<string | undefined> {
  if (reduction.status !== "open") return undefined;

  const deal = (reduction.active?.Payload as Record<string, unknown> | undefined)?.Deal as DealPayload | undefined;
  let inspection: InspectDealResult | undefined;
  if (deal) {
    try {
      inspection = await inspectDeal(thread.player1ID, thread.player2ID, deal);
    } catch (error) {
      logger.warn("Could not inspect active deal for diplomat context", { error });
    }
  }

  const civName = (id: number): string => identityOf(thread, id)?.name ?? `Player ${id}`;
  return formatDealContext(reduction, thread.agent, civName, { inspection, players, relationships });
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
      const deal = row.Payload.Deal;
      if (!deal) return undefined;
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
