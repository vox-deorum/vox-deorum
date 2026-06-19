/**
 * @module envoy/diplomat-deal-tools
 *
 * The on-the-table deal context the diplomat sees on every step (interactive-diplomacy stage 5).
 * The diplomat NEVER authors deal terms — it hands the conversational context to its negotiator
 * through the `call-negotiator` agent-tool and voices the negotiator's move out. This module
 * only renders the active proposal (terms, the negotiator's rationale/message, per-item value
 * snapshots, and status) into the diplomat's model context so it can voice each move faithfully.
 */

import type { EnvoyThread } from "../types/index.js";
import { deriveActiveProposal, type DealReduction } from "../utils/diplomacy/deal-reduce.js";
import { inspectDeal, readDealMessages, type InspectDealResult } from "../utils/diplomacy/deal.js";
import { createLogger } from "../utils/logger.js";
import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";
import type { DealPayload, PerItemValueMap } from "../../../mcp-server/dist/utils/deal-schema.js";

const logger = createLogger("diplomat-deal-tools");

/** Format a per-item value snapshot map (index → value) compactly, or undefined if empty. */
function formatValueMap(label: string, map: PerItemValueMap | undefined): string | undefined {
  if (!map || Object.keys(map).length === 0) return undefined;
  const parts = Object.entries(map).map(([i, v]) => `item[${i}]=${v}`);
  return `${label}: ${parts.join(", ")}`;
}

/** Format promise agreeability factors for the active deal, or a note when unavailable. */
function formatPromiseAgreeability(deal: DealPayload, inspection: InspectDealResult | undefined): string | undefined {
  if (deal.promises.length === 0) return undefined;
  if (!inspection) return "Promise agreeability estimates are unavailable right now.";
  // Model context — render as markdown, never JSON (see utils/tools/json-to-markdown).
  return `Promise agreeability estimates:\n${jsonToMarkdown(inspection.promises)}`;
}

/**
 * Format the on-the-table deal the diplomat must "see at every step": the active proposal's
 * terms, the negotiator's inward `rationale` and one-sentence `message`, the stored per-item
 * value snapshots, fresh promise agreeability factors, and the proposal's current status.
 * Private rationale is included only for a proposal authored by the diplomat's own seat.
 * Returns undefined when no deal is active.
 */
export function formatDealContext(
  reduction: DealReduction,
  viewerID: number,
  inspection?: InspectDealResult
): string | undefined {
  const active = reduction.active;
  if (!active) return undefined;

  const payload = (active.Payload ?? {}) as Record<string, unknown>;
  const deal = payload.Deal as DealPayload | undefined;
  if (!deal) return undefined;

  const lines: string[] = [
    `# Deal on the table (${active.MessageType}, message #${active.ID}, status: ${reduction.status})`,
    // Model context — render as markdown, never JSON (see utils/tools/json-to-markdown).
    `Terms:\n${jsonToMarkdown({ items: deal.items, promises: deal.promises })}`,
  ];
  if (active.SpeakerID === viewerID && deal.rationale) {
    lines.push(`Your negotiator's rationale (for you, do not quote): ${deal.rationale}`);
  }
  if (deal.message) lines.push(`Negotiator's one-sentence line: "${deal.message}"`);

  const v1 = formatValueMap("Player1 per-item values", payload.Value1 as PerItemValueMap | undefined);
  const v2 = formatValueMap("Player2 per-item values", payload.Value2 as PerItemValueMap | undefined);
  if (v1) lines.push(v1);
  if (v2) lines.push(v2);
  const promiseAgreeability = formatPromiseAgreeability(deal, inspection);
  if (promiseAgreeability) lines.push(promiseAgreeability);

  if (reduction.status === "open") {
    lines.push(
      "This deal awaits a response. If it came from the counterpart, call your negotiator with a briefing; if you authored it, await their reply."
    );
  }
  return lines.join("\n");
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

  return formatDealContext(reduction, thread.agent, inspection);
}
