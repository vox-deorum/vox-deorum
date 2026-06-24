/**
 * @module envoy/utils/negotiator-utils
 *
 * Helper types, formatters, and the terminal-tool factory for the negotiator agent
 * (interactive-diplomacy stage 5). The {@link Negotiator} agent class in `../negotiator.ts`
 * composes these: {@link NegotiatorInput} / {@link NegotiatorMove} shape the move it produces,
 * the `format*` / `summarize*` helpers render the model context and the diplomat-facing
 * summary, and {@link createNegotiatorTerminalTools} builds the three terminal tools
 * (accept / propose / reject) that persist the chosen move through the durable store.
 */

import { z } from "zod";
import { Tool } from "ai";
import { VoxContext } from "../../infra/vox-context.js";
import { StrategistParameters } from "../../strategist/strategy-parameters.js";
import {
  createSimpleTool,
  type SimpleToolExecutionOptions,
} from "../../utils/tools/simple-tools.js";
import { createLogger } from "../../utils/logger.js";
import type { EnvoyThread } from "../../types/index.js";
import {
  appendDealProposal,
  appendDealReject,
  enactAgentDeal,
  requireCurrentOpenProposal,
  requireNoOpenProposal,
  type InspectDealResult,
  type EnactDealResult,
} from "../../utils/diplomacy/deal.js";
import { jsonToMarkdown } from "../../utils/tools/json-to-markdown.js";
import {
  AuthoredTradeItemSchema,
  PromiseTermSchema,
  type DealPayload,
} from "../../../../mcp-server/dist/utils/deal-schema.js";

const logger = createLogger("negotiator");

/** The negotiator's three terminal tool names — exactly one must be called per invocation. */
export const NEGOTIATOR_TERMINAL_TOOLS = ["accept-deal", "propose-deal", "reject-deal"] as const;

/** The on-the-table deal from the counterpart being responded to. Absent when proposing outright. */
export interface ActiveProposalContext {
  /** Append ID of the deal-proposal / deal-counter being relayed. */
  messageID: number;
  /** The proposed terms stored on that message. */
  deal: DealPayload;
}

/** The negotiator's chosen move, set by the terminal tool it calls and read back by the loop. */
export type NegotiatorMove =
  | { type: "accept"; rationale: string; proposalMessageID: number; enact: EnactDealResult }
  | {
      type: "propose" | "counter";
      rationale: string;
      message: string;
      dealMessageID: number;
      deal: DealPayload;
      inspection?: InspectDealResult;
      turn?: number;
    }
  | { type: "reject"; rationale: string; proposalMessageID: number; rejectMessageID: number };

/**
 * The negotiator's input. Built by `Negotiator.resolveHandoffInput` from the diplomat's
 * `call-negotiator` arguments plus the ambient conversation thread. The thread is used only by
 * the terminal tools to write the move (never fed to the model). `activeProposal` is derived
 * from the transcript in `Negotiator.getInitialMessages`; the terminal tools set
 * `outcome`, which `getOutput` reads back to summarize for the diplomat.
 */
export interface NegotiatorInput {
  /** The conversation thread (endpoint pair + roles). Used for transcript writes, not modeled. */
  thread: EnvoyThread;
  /** The diplomat's briefing of the conversational context (context 1). */
  briefing: string;
  /** Strategic intent for an outright proposal (no on-the-table deal) — no terms. */
  intent?: string;
  /** The on-the-table deal from the counterpart, when one awaits a response. Derived, not authored. */
  activeProposal?: ActiveProposalContext;
  /** Set by the terminal tool the negotiator calls. */
  outcome?: NegotiatorMove;
}

/** Format the upfront inspect-deal results into a compact, model-readable block (context 2). */
export function formatInspection(inspection: InspectDealResult): string {
  const sections: string[] = [];

  if (inspection.items.length > 0) {
    const lines = inspection.items.map((it, i) => {
      const legal = it.legality ? "legal" : `ILLEGAL (${it.reasons.join("; ") || "no reason given"})`;
      return `  [${i}] ${it.itemType}: ${it.fromPlayerID}→${it.toPlayerID} — ${legal}; value if I give = ${it.valueIfIGive}, value if I receive = ${it.valueIfIReceive}`;
    });
    sections.push(`### On-the-table trade items (per-term legality + AI value, advisory)\n${lines.join("\n")}`);
  }

  // Model context — render as markdown, never JSON (see utils/tools/json-to-markdown).
  if (inspection.promises.length > 0) {
    sections.push(
      `### On-the-table promises (agreeability factors, advisory)\n${jsonToMarkdown(inspection.promises)}`
    );
  }

  sections.push(
    `### Tradable range per side (what each civ could put on the table)\n${jsonToMarkdown(inspection.tradableRange)}`
  );

  return sections.join("\n\n");
}

/** Format the on-the-table proposed terms (context 3) for the model. */
export function formatActiveProposal(active: ActiveProposalContext): string {
  // Model context — render as markdown, never JSON (see utils/tools/json-to-markdown).
  return `### The deal on the table (proposal message #${active.messageID})\n${jsonToMarkdown(
    { items: active.deal.items, promises: active.deal.promises, message: active.deal.message }
  )}`;
}

/** Render a newly authored deal's terms and proposal-time estimates for the diplomat. */
function summarizeAuthoredDeal(move: Extract<NegotiatorMove, { type: "propose" | "counter" }>): string {
  // Model context — render as markdown, never JSON (see utils/tools/json-to-markdown).
  const lines = [`Terms:\n${jsonToMarkdown({ items: move.deal.items, promises: move.deal.promises })}`];
  if (move.inspection) {
    lines.push(
      `Proposal-time estimates:\n${jsonToMarkdown({ items: move.inspection.items, promises: move.inspection.promises })}`
    );
  } else {
    lines.push("Proposal-time estimates were unavailable; describe the stored terms without inventing values.");
  }
  return lines.join("\n");
}

/** Render the negotiator's move into a briefing the diplomat reasons over and voices. */
export function summarizeMove(move: NegotiatorMove): string {
  switch (move.type) {
    case "accept":
      return [
        "Your negotiator has ACCEPTED the deal on the table.",
        `Rationale (for you, do not quote): ${move.rationale}`,
        move.enact.alreadyEnacted
          ? "This deal was already agreed earlier."
          : "The agreement has been recorded" +
            (move.enact.enacted ? " and enacted." : " (in-game enactment lands in stage 6)."),
        "Voice the acceptance to the counterpart in your own words.",
      ].join("\n");
    case "reject":
      return [
        "Your negotiator has REJECTED the deal on the table.",
        `Rationale (for you, do not quote): ${move.rationale}`,
        "Voice the rejection to the counterpart in your own words — firm but not needlessly hostile.",
      ].join("\n");
    case "propose":
    case "counter":
      return [
        `Your negotiator has prepared a ${move.type === "counter" ? "COUNTER" : "PROPOSAL"} (deal message #${move.dealMessageID}).`,
        `Rationale (for you, do not quote): ${move.rationale}`,
        `Suggested one-sentence line to voice (elaborate around it): "${move.message}"`,
        summarizeAuthoredDeal(move),
        "The deal is now on the table for the counterpart to accept, counter, or reject.",
      ].join("\n");
  }
}

/**
 * Build the negotiator's three terminal tools. Each reads the live `NegotiatorInput` from
 * `context.currentInput` (set by VoxContext.execute for this agent run), writes its move
 * through the durable store, and records the chosen move on `input.outcome` for the loop.
 */
export function createNegotiatorTerminalTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
  const input = (): NegotiatorInput | undefined => context.currentInput as NegotiatorInput | undefined;
  const stepClaims = new WeakMap<object, string>();

  /**
   * Claim the current model step for its first terminal call. AI SDK executes all calls from
   * one step concurrently and passes the same messages array to each, giving us a stable
   * per-step key. Later terminal calls are dropped before they can read or mutate deal state.
   */
  const claimStep = (options: SimpleToolExecutionOptions, toolName: string): string | undefined => {
    const stepKey = options.messages;
    const claimed = stepClaims.get(stepKey);
    if (claimed) return claimed;
    stepClaims.set(stepKey, toolName);
    return undefined;
  };

  const acceptDeal = createSimpleTool<StrategistParameters>(
    {
      name: "accept-deal",
      description:
        "Accept the deal on the table exactly as-is. Provide your inward rationale for the diplomat. The agreement is recorded and routed to enactment. Use only when a deal is on the table.",
      inputSchema: z.object({
        rationale: z.string().describe("Inward reasoning for the diplomat (not voiced verbatim)."),
      }),
      execute: async (args, _parameters, options) => {
        const ni = input();
        if (!ni) return "No negotiation context is active.";
        const claimed = claimStep(options, "accept-deal");
        if (claimed) return `Ignored because ${claimed} was the first terminal tool call in this step.`;
        if (!ni.activeProposal) return "There is no deal on the table to accept. Use propose-deal instead.";
        try {
          await requireCurrentOpenProposal(
            ni.thread,
            ni.activeProposal.messageID,
            ni.thread.agent
          );
          const enact = await enactAgentDeal(ni.activeProposal.messageID, {
            accepterID: ni.thread.agent,
            content: "The deal was accepted.",
          });
          ni.outcome = {
            type: "accept",
            rationale: args.rationale,
            proposalMessageID: ni.activeProposal.messageID,
            enact,
          };
          return `Accepted proposal #${ni.activeProposal.messageID}. Agreement recorded${
            enact.enacted ? " and enacted" : " (in-game enactment pending stage 6)"
          }.`;
        } catch (error) {
          logger.warn("Could not accept stale or invalid proposal", { error });
          return `Could not accept the deal: ${error instanceof Error ? error.message : "unknown error"}. Choose again.`;
        }
      },
    },
    context
  );

  const proposeCounterDeal = createSimpleTool<StrategistParameters>(
    {
      name: "propose-deal",
      description:
        "Author the deal terms to present: a counter to the deal on the table, or an opening proposal when none is on the table. Provide an inward rationale for the diplomat and a single-sentence outward message to be voiced.",
      inputSchema: z.object({
        rationale: z.string().describe("Inward reasoning for the diplomat (not voiced verbatim)."),
        message: z
          .string()
          .describe("One single sentence the diplomat will voice to the counterpart."),
        items: z.array(AuthoredTradeItemSchema).default([]).describe("Ordinary trade terms (each directed between the two civs). Durations are fixed by the game and filled in automatically — do not specify them. Mutual agreements (Declaration of Friendship, Defensive Pact, Research Agreement, Peace Treaty) bind both sides and are auto-completed onto both, so you may list one side."),
        promises: z.array(PromiseTermSchema).default([]).describe("Promise commitment terms (directed between the two civs)."),
      }),
      execute: async (args, _parameters, options) => {
        const ni = input();
        if (!ni) return "No negotiation context is active.";
        const claimed = claimStep(options, "propose-deal");
        if (claimed) return `Ignored because ${claimed} was the first terminal tool call in this step.`;
        if (args.items.length === 0 && args.promises.length === 0) {
          return "A proposal must include at least one trade item or promise. Reject instead if you want no deal.";
        }
        const isCounter = ni.activeProposal !== undefined;
        const deal: DealPayload = {
          version: 1,
          items: args.items,
          promises: args.promises,
          rationale: args.rationale,
          message: args.message,
        };
        try {
          if (isCounter) {
            await requireCurrentOpenProposal(
              ni.thread,
              ni.activeProposal!.messageID,
              ni.thread.agent
            );
          } else {
            await requireNoOpenProposal(ni.thread);
          }
          // appendDealProposal stamps the fixed per-type durations and returns the canonical deal;
          // use it so the diplomat briefing reflects exactly what was stored.
          const { id, turn, inspection, deal: storedDeal } = await appendDealProposal(
            ni.thread,
            ni.thread.agent,
            isCounter ? "deal-counter" : "deal-proposal",
            args.message,
            deal
          );
          ni.outcome = {
            type: isCounter ? "counter" : "propose",
            rationale: args.rationale,
            message: args.message,
            dealMessageID: id,
            deal: storedDeal,
            inspection,
            turn,
          };
          return `${isCounter ? "Counter" : "Proposal"} recorded as deal message #${id}.`;
        } catch (error) {
          logger.error("Failed to record proposal/counter", { error });
          return `Failed to record the deal: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      },
    },
    context
  );

  const rejectDeal = createSimpleTool<StrategistParameters>(
    {
      name: "reject-deal",
      description:
        "Reject the deal on the table exactly as-is. Provide your inward rationale for the diplomat. Use only when a deal is on the table.",
      inputSchema: z.object({
        rationale: z.string().describe("Inward reasoning for the diplomat (not voiced verbatim)."),
      }),
      execute: async (args, _parameters, options) => {
        const ni = input();
        if (!ni) return "No negotiation context is active.";
        const claimed = claimStep(options, "reject-deal");
        if (claimed) return `Ignored because ${claimed} was the first terminal tool call in this step.`;
        if (!ni.activeProposal) return "There is no deal on the table to reject.";
        try {
          await requireCurrentOpenProposal(
            ni.thread,
            ni.activeProposal.messageID,
            ni.thread.agent
          );
          const { id } = await appendDealReject(
            ni.thread,
            ni.thread.agent,
            "The proposed deal was declined.",
            ni.activeProposal.messageID
          );
          ni.outcome = {
            type: "reject",
            rationale: args.rationale,
            proposalMessageID: ni.activeProposal.messageID,
            rejectMessageID: id,
          };
          return `Rejected proposal #${ni.activeProposal.messageID} (deal-reject #${id}).`;
        } catch (error) {
          logger.error("Failed to record rejection", { error });
          return `Failed to record the rejection: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      },
    },
    context
  );

  return {
    "accept-deal": acceptDeal,
    "propose-deal": proposeCounterDeal,
    "reject-deal": rejectDeal,
  };
}
