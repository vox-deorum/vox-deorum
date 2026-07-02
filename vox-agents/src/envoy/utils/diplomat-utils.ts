/**
 * @module envoy/utils/diplomat-utils
 *
 * The on-the-table deal context the diplomat sees on every step (interactive-diplomacy stage 5).
 * The diplomat NEVER authors deal terms — it hands the conversational context to its negotiator
 * through the `call-negotiator` agent-tool and voices the negotiator's move out. This module
 * only renders the active proposal (terms, the negotiator's rationale/message, per-item value
 * snapshots, and status) into the diplomat's model context so it can voice each move faithfully.
 */

import type { EnvoyThread } from "../../types/index.js";
import { deriveActiveProposal, type DealReduction } from "../../utils/diplomacy/deal-reduce.js";
import { inspectDeal, readDealMessages, type InspectDealResult } from "../../utils/diplomacy/deal.js";
import { createLogger } from "../../utils/logger.js";
import { jsonToMarkdown } from "../../utils/tools/json-to-markdown.js";
import { formatDealTermsByDirection } from "../../../../mcp-server/dist/utils/deal-format.js";
import { identityOf } from "../../utils/diplomacy/transcript-utils.js";
import type { DealPayload, PerItemValueMap } from "../../../../mcp-server/dist/utils/deal-schema.js";

const logger = createLogger("diplomat-deal");

/** Format promise agreeability factors for the active deal, or a note when unavailable. */
function formatPromiseAgreeability(deal: DealPayload, inspection: InspectDealResult | undefined): string | undefined {
  if (deal.promises.length === 0) return undefined;
  if (!inspection) return "Promise agreeability estimates are unavailable right now.";
  // Model context — render as markdown, never JSON (see utils/tools/json-to-markdown).
  return `Promise agreeability estimates:\n${jsonToMarkdown(inspection.promises)}`;
}

/**
 * Format the on-the-table deal the diplomat must "see at every step": the active proposal's
 * terms (grouped by direction with civ names and the advisory per-item value estimates), the
 * negotiator's inward `rationale` and one-sentence `message`, fresh promise agreeability factors,
 * and the proposal's current status. Private rationale is included only for a proposal authored by
 * the diplomat's own seat. `civName` resolves a seat's civ name (defaults to "Player <id>").
 * Returns undefined when no deal is active.
 */
export function formatDealContext(
  reduction: DealReduction,
  viewerID: number,
  civName?: (playerID: number) => string,
  inspection?: InspectDealResult
): string | undefined {
  const active = reduction.active;
  if (!active) return undefined;

  const payload = (active.Payload ?? {}) as Record<string, unknown>;
  const deal = payload.Deal as DealPayload | undefined;
  if (!deal) return undefined;

  const resolveName = civName ?? ((id: number) => `Player ${id}`);
  const terms = formatDealTermsByDirection(
    deal,
    payload.Value1 as PerItemValueMap | undefined,
    payload.Value2 as PerItemValueMap | undefined,
    active.Player1ID,
    active.Player2ID,
    resolveName,
    viewerID
  );

  const header = `# Deal on the table (${active.MessageType}, message #${active.ID}, status: ${reduction.status})`;
  // The header and the advisory-marked terms read as one tight block; everything after is spaced.
  const blocks: string[] = [terms ? `${header}\n${terms}` : header];

  if (active.SpeakerID === viewerID && deal.rationale) {
    blocks.push(`Your negotiator's rationale (for you, do not quote): ${deal.rationale}`);
  }
  if (deal.message) blocks.push(`Negotiator's one-sentence line: "${deal.message}"`);

  const promiseAgreeability = formatPromiseAgreeability(deal, inspection);
  if (promiseAgreeability) blocks.push(promiseAgreeability);

  if (reduction.status === "open") {
    blocks.push(
      "This deal awaits a response. If it came from the counterpart, call your negotiator with a briefing; if you authored it, await their reply."
    );
  }
  return blocks.join("\n\n");
}

/**
 * Read and reduce the conversation's deal messages, then format the active deal context for
 * the diplomat's model input. Returns undefined when no deal is on the table.
 */
export async function buildDealContextMessage(thread: EnvoyThread): Promise<string | undefined> {
  if (thread.player1ID === undefined || thread.player2ID === undefined) return undefined;
  const messages = await readDealMessages(thread.player1ID, thread.player2ID);
  const reduction = deriveActiveProposal(messages);

  const deal = (reduction.active?.Payload as Record<string, unknown> | undefined)?.Deal as DealPayload | undefined;
  let inspection: InspectDealResult | undefined;
  if (deal?.promises.length) {
    try {
      inspection = await inspectDeal(thread.player1ID, thread.player2ID, deal);
    } catch (error) {
      logger.warn("Could not inspect active deal for diplomat context", { error });
    }
  }

  const civName = (id: number): string => identityOf(thread, id)?.name ?? `Player ${id}`;
  return formatDealContext(reduction, thread.agent, civName, inspection);
}
