/**
 * @module envoy/utils/negotiator-utils
 *
 * Helper types, formatters, and the terminal-tool factory for the negotiator agent
 * (interactive-diplomacy stage 5). The {@link Negotiator} agent class in `../negotiator.ts`
 * composes these: {@link NegotiatorInput} / {@link NegotiatorMove} shape the move it produces,
 * the `format*` / `summarize*` helpers render the model context and the diplomat-facing
 * summary, and {@link createNegotiatorTerminalTools} builds the three terminal tools
 * (accept / propose / reject) that persist the chosen move through the durable store. The
 * GIVE/TAKE menu renderer lives in `./give-take-menu.ts` (re-exported below).
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
  IllegalDealError,
  type InspectDealResult,
  type EnactDealResult,
} from "../../utils/diplomacy/deal.js";
import { itemTypeLabel } from "../../../../mcp-server/dist/utils/deal-format.js";
import {
  resolveLedger,
  formatResolutionErrors,
} from "./ledger-resolver.js";
import type { DealPayload } from "../../../../mcp-server/dist/utils/deal-schema.js";
import {
  endpoints,
  formatDealLedger,
  ledgerContextFor,
  type DealLedgerOptions,
} from "./deal-ledger.js";

export { formatGiveTakeLedger } from "./give-take-menu.js";

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
  | { type: "accept"; rationale: string; message: string; proposalMessageID: number; enact: EnactDealResult }
  | {
      type: "propose" | "counter";
      rationale: string;
      message: string;
      dealMessageID: number;
      deal: DealPayload;
      inspection?: InspectDealResult;
      turn?: number;
    }
  | { type: "reject"; rationale: string; message: string; proposalMessageID: number; rejectMessageID: number };

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
  /**
   * The upfront `inspect-deal` result (tradable range + promise targets) computed in
   * `getInitialMessages`. The `propose-deal` tool reads it to resolve the authored Give/Take NAMES
   * back into IDs without re-inspecting. Absent when the upfront inspection failed.
   */
  upfrontInspection?: InspectDealResult;
  /** Set by the terminal tool the negotiator calls. */
  outcome?: NegotiatorMove;
}

/**
 * Format the on-the-table proposal (context 3) as the shared unified ledger: the counterpart's
 * one-line message, our leader's intention toward them, and every term grouped by direction with the
 * advisory per-item value estimates and third-party relationship context. Always a counterpart-authored
 * deal here (the negotiator only ever responds to the other side's offer), so the message is "theirs".
 */
export function formatActiveProposalLedger(
  active: ActiveProposalContext,
  thread: EnvoyThread,
  options?: DealLedgerOptions
): string {
  const messageBlock = active.deal.message ? `## Their Message\n> ${active.deal.message}` : undefined;
  return formatDealLedger(
    active.deal,
    `# Deal On The Table (#${active.messageID})`,
    ledgerContextFor(thread),
    { ...options, messageBlock }
  );
}

/**
 * Reframe an {@link IllegalDealError} into first-person Give/Take feedback the model can act on. Each
 * structured detail whose giver is the negotiator's own seat is a Give; otherwise it is a Take. A
 * structural error carries no per-item details (the endpoint/targeting guards), so its human-readable
 * reasons are relayed verbatim. No deal was written, so the model can adjust and retry.
 */
function formatIllegalDealError(error: IllegalDealError, agentID: number): string {
  const lines = error.details.length
    ? error.details.map((d) => {
        const side = d.fromPlayerID === agentID ? "Give" : "Take";
        return `- [${side}] ${itemTypeLabel(d.itemType)}: ${d.reasons.join("; ") || "not tradeable"}`;
      })
    : error.reasons.map((r) => `- ${r}`);
  return ["This deal can't be made. Adjust these terms and try again:", ...lines].join("\n");
}

/** Render a newly authored deal's terms and proposal-time estimates for the diplomat. */
function summarizeAuthoredDeal(
  move: Extract<NegotiatorMove, { type: "propose" | "counter" }>,
  thread: EnvoyThread
): string {
  // Same unified ledger the diplomat sees for the on-the-table deal; the fresh proposal-time
  // inspection supplies the per-item value estimates. No players/relationships context is threaded
  // into the move summary, so third-party relationship lines are omitted here.
  const terms = formatDealLedger(move.deal, "Proposed terms:", ledgerContextFor(thread), {
    inspection: move.inspection,
  });
  const lines = [terms];
  if (!move.inspection) {
    lines.push("Proposal-time estimates were unavailable; describe the stored terms without inventing values.");
  }
  return lines.join("\n");
}

/** Render the negotiator's move into a briefing the diplomat reasons over and voices. */
export function summarizeMove(move: NegotiatorMove, thread: EnvoyThread): string {
  switch (move.type) {
    case "accept":
      return [
        "Your negotiator has ACCEPTED the deal on the table.",
        `- Rationale (for you, do not quote): ${move.rationale}`,
        move.enact.alreadyEnacted
          ? "This deal was already agreed and enacted earlier."
          : "The agreement has been recorded" +
            (move.enact.enacted ? " and enacted in-game." : " but the deal was not enacted in-game."),
        `- Message to the counterpart: "${move.message}"`,
      ].join("\n");
    case "reject":
      return [
        "Your negotiator has REJECTED the deal on the table.",
        `- Rationale (for you, do not quote): ${move.rationale}`,
        `- Message to the counterpart: "${move.message}"`,
      ].join("\n");
    case "propose":
    case "counter":
      return [
        `Your negotiator has prepared a ${move.type === "counter" ? "COUNTER" : "PROPOSAL"} (deal message #${move.dealMessageID}).`,
        `- Rationale (for you, do not quote): ${move.rationale}`,
        `- Message to the counterpart: "${move.message}"`,
        summarizeAuthoredDeal(move, thread),
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
        "Accept the deal on the table. Provide your inward rationale for the diplomat and a single-sentence outward message to be voiced. Use only when a deal is on the table.",
      inputSchema: z.object({
        Rationale: z.string().describe("Inward reasoning for the diplomat (not voiced verbatim)."),
        Message: z
          .string()
          .describe("One single sentence the diplomat will voice to the counterpart, conveying the acceptance."),
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
          // The outward Message is recorded as the deal-accept row's Content so the UI surfaces it as
          // the diplomat's reply in the acceptance notice.
          const enact = await enactAgentDeal(ni.activeProposal.messageID, {
            accepterID: ni.thread.agent,
            content: args.Message,
          });
          ni.outcome = {
            type: "accept",
            rationale: args.Rationale,
            message: args.Message,
            proposalMessageID: ni.activeProposal.messageID,
            enact,
          };
          return `Accepted proposal #${ni.activeProposal.messageID} ${
            enact.enacted
              ? "(enacted)."
              : enact.alreadyEnacted
                ? "(enacted earlier)."
                : "(not enacted)."
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
        "Present a new or counter deal offer. Author two lists of plain strings: Give (what your civ gives the counterpart) and Take (what the counterpart gives your civ), each string a term copied from the GIVE/TAKE menu following the example on its heading. Provide an inward rationale for the diplomat and a single-sentence outward message to be voiced.",
      inputSchema: z.object({
        Rationale: z.string().describe("Inward reasoning for the diplomat (not voiced verbatim)."),
        Message: z
          .string()
          .describe("One single sentence the diplomat will voice to the counterpart."),
        Give: z
          .array(z.string())
          .default([])
          .describe(
            "Terms YOUR civ gives the counterpart, one plain string per term copied from the GIVE menu. " +
              'Follow the quoted example on each heading, e.g. "Gold 100", "Iron 2", "Open Borders", ' +
              '"Third-Party Peace with <Civilization>". Append a whole number only for Gold, Gold Per Turn, or a resource quantity.'
          ),
        Take: z
          .array(z.string())
          .default([])
          .describe("Terms the counterpart gives YOUR civ, one plain string per term copied from the TAKE menu (same format as Give)."),
      }),
      execute: async (args, _parameters, options) => {
        const ni = input();
        if (!ni) return "No negotiation context is active.";
        const claimed = claimStep(options, "propose-deal");
        if (claimed) return `Ignored because ${claimed} was the first terminal tool call in this step.`;
        if (args.Give.length === 0 && args.Take.length === 0) {
          return "A proposal must include at least one term in Give or Take. Reject instead if you want no deal.";
        }

        // Resolve the authored NAMES against the upfront tradable range (the same menu the model saw).
        const { agentID, counterpartID } = endpoints(ni.thread);
        const insp = ni.upfrontInspection;
        const { items, promises, errors } = resolveLedger({
          give: args.Give,
          take: args.Take,
          agentID,
          counterpartID,
          giveRange: insp?.tradableRange[String(agentID)],
          takeRange: insp?.tradableRange[String(counterpartID)],
          promiseTargets: insp?.promiseTargets ?? [],
        });
        if (errors.length > 0) {
          // Nothing is written; return correctable feedback so the model can fix names and retry.
          return formatResolutionErrors(errors);
        }

        const isCounter = ni.activeProposal !== undefined;
        const deal: DealPayload = {
          version: 1,
          items,
          promises,
          rationale: args.Rationale,
          message: args.Message,
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
            deal
          );
          ni.outcome = {
            type: isCounter ? "counter" : "propose",
            rationale: args.Rationale,
            message: args.Message,
            dealMessageID: id,
            deal: storedDeal,
            inspection,
            turn,
          };
          return `${isCounter ? "Counter" : "Proposal"} recorded as deal message #${id}.`;
        } catch (error) {
          // An untradeable term: reframe each per-item reason in Give/Take terms so the model can fix it.
          if (error instanceof IllegalDealError) {
            return formatIllegalDealError(error, agentID);
          }
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
        "Reject the deal on the table. Provide your inward rationale for the diplomat and a single-sentence outward message to be voiced.",
      inputSchema: z.object({
        Rationale: z.string().describe("Inward reasoning for the diplomat (not voiced verbatim)."),
        Message: z
          .string()
          .describe("One single sentence the diplomat will voice to the counterpart, conveying the rejection."),
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
          // The outward Message is recorded as the deal-reject row's Content so the UI renders it on the
          // reject's own standalone card (and the reject still reduces the proposal's status to rejected).
          const { id } = await appendDealReject(
            ni.thread,
            ni.thread.agent,
            args.Message,
            ni.activeProposal.messageID
          );
          ni.outcome = {
            type: "reject",
            rationale: args.Rationale,
            message: args.Message,
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
