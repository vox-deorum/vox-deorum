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
import { deriveActiveProposal, type DealReduction } from "../../utils/diplomacy/deal-reduce.js";
import { inspectDeal, readDealMessages, type InspectDealResult } from "../../utils/diplomacy/deal.js";
import { createLogger } from "../../utils/logger.js";
import { identityOf } from "../../utils/diplomacy/transcript-utils.js";
import type { DealPayload } from "../../../../mcp-server/dist/utils/deal-schema.js";
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
    // This block lands after the turn hint (getInitialMessages puts it last, closest to the
    // action), and the author is known here — so state the open-deal ask directly instead of
    // leaving the model an if-else, overriding the hint's generic gather-intelligence nudge.
    blocks.push(
      ownAuthored
        ? "Your proposal awaits the counterpart's reply. Do not call the negotiator again until they respond."
        : "The counterpart's deal is on the table. Hand it to the negotiator by calling `call-negotiator` with a `Briefing` of the conversation so far. The negotiator decides whether to accept, counter, or reject."
    );
  }
  return blocks.join("\n\n");
}

/**
 * Read and reduce the conversation's deal messages, then format the active deal context for the
 * diplomat's model input. For an OPEN deal it inspects fresh (per-term value + third-party context);
 * closed deals render terms only. `players`/`relationships` (from the caller's already-fetched game
 * state) supply the third-party relationship lines. Returns undefined when no deal is on the table.
 */
export async function buildDealContextMessage(
  thread: EnvoyThread,
  players?: PlayersReport,
  relationships?: RelationshipDirectives
): Promise<string | undefined> {
  if (thread.player1ID === undefined || thread.player2ID === undefined) return undefined;
  const messages = await readDealMessages(thread.player1ID, thread.player2ID);
  const reduction = deriveActiveProposal(messages);

  const deal = (reduction.active?.Payload as Record<string, unknown> | undefined)?.Deal as DealPayload | undefined;
  let inspection: InspectDealResult | undefined;
  if (deal && reduction.status === "open") {
    try {
      inspection = await inspectDeal(thread.player1ID, thread.player2ID, deal);
    } catch (error) {
      logger.warn("Could not inspect active deal for diplomat context", { error });
    }
  }

  const civName = (id: number): string => identityOf(thread, id)?.name ?? `Player ${id}`;
  return formatDealContext(reduction, thread.agent, civName, { inspection, players, relationships });
}
