/**
 * @module envoy/negotiator
 *
 * The negotiator agent (interactive-diplomacy stage 5) — a deal specialist invoked by the
 * diplomat through the diplomat⇔negotiator loop, and the **sole decider of deal terms**.
 *
 * It never reads the human free-text thread. It is grounded by three contexts (specs §7):
 *  (1) general game context + strategy/persona — its own `get-briefing` / `get-diplomatic-events`
 *      tools plus the diplomat's briefing;
 *  (2) what is tradable and each item's value — the `inspect-deal` results (tradable range +
 *      per-term legality/value + promise agreeability), run UPFRONT by the loop and placed in
 *      its context (it does not call inspect-deal itself);
 *  (3) what is on the table — the active proposal the diplomat relays (absent when proposing).
 *
 * It chooses EXACTLY ONE of three terminal tools per invocation, each returning an inward
 * `rationale` (reasoning for the diplomat, never voiced verbatim):
 *  - `accept-deal`        — accept the on-the-table deal as-is (routes through enact-agent-deal);
 *  - `propose-counter-deal` — author a draft deal (counter, or an opening proposal), with a
 *                            one-sentence outward `message`; stored as deal-counter / deal-proposal;
 *  - `reject-deal`        — decline the on-the-table deal as-is.
 *
 * Authority is baked into the chosen negotiator agent (specs §7) — there is no separate
 * ratification knob.
 */

import { z } from "zod";
import { ModelMessage, StepResult, Tool } from "ai";
import { VoxAgent } from "../infra/vox-agent.js";
import { VoxContext } from "../infra/vox-context.js";
import { StrategistParameters, buildGameContextMessages } from "../strategist/strategy-parameters.js";
import { createBriefingTool } from "../briefer/briefing-utils.js";
import {
  createSimpleTool,
  type SimpleToolExecutionOptions,
} from "../utils/tools/simple-tools.js";
import { createLogger } from "../utils/logger.js";
import type { EnvoyThread } from "../types/index.js";
import {
  appendDealProposal,
  appendDealReject,
  enactAgentDeal,
  inspectDeal,
  readActiveProposal,
  requireCurrentOpenProposal,
  requireNoOpenProposal,
  type InspectDealResult,
  type EnactDealResult,
} from "../utils/diplomacy/deal.js";
import { activeProposalDeal } from "../utils/diplomacy/deal-reduce.js";
import { resolveNegotiator } from "../utils/diplomacy/resolve-negotiator.js";
import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";
import {
  TradeItemSchema,
  PromiseTermSchema,
  type DealPayload,
} from "../../../mcp-server/dist/utils/deal-schema.js";

const logger = createLogger("negotiator");

/** The negotiator's three terminal tool names — exactly one must be called per invocation. */
export const NEGOTIATOR_TERMINAL_TOOLS = ["accept-deal", "propose-counter-deal", "reject-deal"] as const;

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
 * The negotiator's input. Built by {@link Negotiator.resolveHandoffInput} from the diplomat's
 * `call-negotiator` arguments plus the ambient conversation thread. The thread is used only by
 * the terminal tools to write the move (never fed to the model). `activeProposal` is derived
 * from the transcript in {@link Negotiator.getInitialMessages}; the terminal tools set
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
function formatInspection(inspection: InspectDealResult): string {
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
function formatActiveProposal(active: ActiveProposalContext): string {
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
function summarizeMove(move: NegotiatorMove): string {
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
        if (!ni.activeProposal) return "There is no deal on the table to accept. Use propose-counter-deal instead.";
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
      name: "propose-counter-deal",
      description:
        "Author the deal terms to present: a counter to the deal on the table, or an opening proposal when none is on the table. Provide an inward rationale for the diplomat and a single-sentence outward message to be voiced.",
      inputSchema: z.object({
        rationale: z.string().describe("Inward reasoning for the diplomat (not voiced verbatim)."),
        message: z
          .string()
          .describe("One single sentence the diplomat will voice to the counterpart."),
        items: z.array(TradeItemSchema).default([]).describe("Ordinary trade terms (each directed between the two civs)."),
        promises: z.array(PromiseTermSchema).default([]).describe("Promise commitment terms (directed between the two civs)."),
      }),
      execute: async (args, _parameters, options) => {
        const ni = input();
        if (!ni) return "No negotiation context is active.";
        const claimed = claimStep(options, "propose-counter-deal");
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
          const { id, turn, inspection } = await appendDealProposal(
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
            deal,
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
    "propose-counter-deal": proposeCounterDeal,
    "reject-deal": rejectDeal,
  };
}

/**
 * The negotiator agent. A specialist agent-tool (like the analyst, it extends VoxAgent
 * directly rather than the EnvoyThread-typed Envoy) reusing the live-game building blocks:
 * `buildGameContextMessages` for grounding and `createBriefingTool` for on-demand briefings.
 */
export class Negotiator extends VoxAgent<StrategistParameters, NegotiatorInput, string | undefined> {
  readonly name = "negotiator";

  readonly description =
    "A deal specialist who inspects, values, and decides deal terms behind the diplomat — accepting, countering/proposing, or rejecting a deal.";

  public tags = ["active-game", "diplomatic"];

  public override toolDescription =
    "Hand the conversational context to your negotiator. It inspects the game, decides whether to respond to the deal currently on the table or open a new one, records its move, and returns a summary for you to voice.";

  /**
   * Caller-facing schema for the diplomat's `call-negotiator` handoff. The diplomat authors
   * only the briefing (and an optional intent when opening a deal); the conversation thread and
   * the on-the-table proposal are supplied by {@link resolveHandoffInput} / the transcript.
   */
  public override handoffSchema = z.object({
    Briefing: z
      .string()
      .describe("Short briefing of the conversational context for the negotiator (no terms)."),
    Intent: z
      .string()
      .optional()
      .describe("Strategic intent when you want to open a deal — what you hope it achieves (no terms)."),
  });

  /** Merge the diplomat's handoff arguments with the ambient conversation thread. */
  public override resolveHandoffInput(
    callerArgs: unknown,
    context: VoxContext<StrategistParameters>
  ): NegotiatorInput {
    const args = (callerArgs ?? {}) as { Briefing?: string; Intent?: string };
    return {
      thread: context.currentInput as EnvoyThread,
      briefing: args.Briefing ?? "",
      intent: args.Intent,
    };
  }

  /**
   * Dispatch the `call-negotiator` handoff to the voiced seat's configured negotiator (a custom
   * Negotiator variant sharing this input shape), defaulting to this built-in negotiator. The
   * caller's thread is still current here, so its seat drives the per-seat lookup.
   */
  public override resolveHandoffTarget(context: VoxContext<StrategistParameters>): string {
    const thread = context.currentInput as EnvoyThread | undefined;
    return thread ? resolveNegotiator(thread) : this.name;
  }

  /** Let the model reason (e.g. call get-briefing) before committing to a terminal tool. */
  public override toolChoice = "auto";

  /** Stop as soon as one terminal tool has produced a move. */
  public override requiredTools = [...NEGOTIATOR_TERMINAL_TOOLS];

  public override maxSteps = 4;

  /**
   * Stop only after a terminal tool has successfully persisted a move.
   *
   * Terminal tools return explanatory strings for stale state and validation failures so the
   * model can recover on a later step; those strings must not be mistaken for completion.
   */
  public override stopCheck(
    _parameters: StrategistParameters,
    input: NegotiatorInput,
    _lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
    _context: VoxContext<StrategistParameters>
  ): boolean {
    return input.outcome !== undefined || allSteps.length >= this.maxSteps;
  }

  public getActiveTools(_parameters: StrategistParameters): string[] | undefined {
    return ["get-briefing", "get-diplomatic-events", ...NEGOTIATOR_TERMINAL_TOOLS];
  }

  public override getExtraTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
    return {
      "get-briefing": createBriefingTool(context),
      ...createNegotiatorTerminalTools(context),
    };
  }

  public async getSystem(
    parameters: StrategistParameters,
    _input: NegotiatorInput,
    _context: VoxContext<StrategistParameters>
  ): Promise<string> {
    const leader = parameters.metadata?.YouAre?.Leader ?? "your leader";
    const civName = parameters.metadata?.YouAre?.Name ?? "your civilization";

    return `
You are the deal negotiator for ${civName}, serving ${leader}. You decide ${civName}'s deal terms — you are the SOLE decider of what ${civName} will trade or promise.

# Your Situation
- You work behind the diplomat, who speaks to the other civilization. You never see or reply to free-text conversation; you only handle deal mechanics.
- The diplomat relays you a briefing of the conversational context, and (when one exists) the deal currently on the table.
- Your context already includes a fresh inspection of the deal and the tradable range: per trade item you are given structural legality and the game's AI value estimate in both directions; per promise you are given agreeability factors. These are ADVISORY — they inform you, they never bind you. The game will not refuse a deal on valuation grounds on this path.

# Your Resources
- \`get-briefing\` — strategic briefings (Military, Economy, Diplomacy) for ${civName}.
- \`get-diplomatic-events\` — recent diplomatic history with another player.
- Call these first if you need more context before deciding.

# Your Decision — choose EXACTLY ONE terminal tool
- \`accept-deal\` — accept the on-the-table deal exactly as-is. (Only when a deal is on the table.)
- \`propose-counter-deal\` — author the terms to present: a COUNTER to the deal on the table, or an OPENING PROPOSAL when none is on the table. You must include a one-sentence outward \`message\` for the diplomat to voice.
- \`reject-deal\` — decline the on-the-table deal exactly as-is. (Only when a deal is on the table.)

# Conventions
- Every terminal tool takes a \`rationale\`: your inward reasoning FOR THE DIPLOMAT. It is never voiced verbatim.
- Only \`propose-counter-deal\` carries a \`message\`: one concise sentence the diplomat will voice. The diplomat composes the outward wording for accept/reject itself.
- Reason from ${civName}'s strategy, persona, and national interest — not the counterpart's convenience. Drive a hard but realistic bargain.
- Trade items are directed (\`fromPlayerID\` → \`toPlayerID\`) and must run between the two negotiating civs. Promises set \`promiserID\` → \`recipientID\`; Coop War and city-state promises need a third-party \`targetPlayerID\`.`.trim();
  }

  /**
   * Assemble the negotiator's grounding. Determines the task itself from the transcript — a
   * still-open proposal authored by the COUNTERPART is forwarded for a response; anything else
   * (none, or our own pending proposal, or a closed one) means we are opening a deal. Then runs
   * `inspect-deal` upfront (context 2) against the on-the-table deal, or the bare tradable
   * range when proposing. The derived `activeProposal` is stashed on `input` for the terminal
   * tools (which re-validate it against the live transcript before writing).
   */
  public async getInitialMessages(
    parameters: StrategistParameters,
    input: NegotiatorInput,
    _context: VoxContext<StrategistParameters>
  ): Promise<ModelMessage[]> {
    const { thread } = input;

    // (3) what is on the table — reduce the transcript and forward only the counterpart's offer.
    const reduction = await readActiveProposal(thread.player1ID, thread.player2ID);
    const ownPending = reduction.status === "open" && reduction.active?.SpeakerID === thread.agent;
    if (reduction.active && reduction.status === "open" && reduction.active.SpeakerID !== thread.agent) {
      const deal = activeProposalDeal(reduction);
      if (deal) input.activeProposal = { messageID: reduction.active.ID, deal };
    }

    // (2) what is tradable and each item's value — inspect upfront (range only when proposing).
    let inspectionBlock: string;
    try {
      const inspection = await inspectDeal(thread.player1ID, thread.player2ID, input.activeProposal?.deal);
      inspectionBlock = formatInspection(inspection);
    } catch (error) {
      logger.warn("inspect-deal failed; proceeding without value estimates", { error });
      inspectionBlock = "(inspection unavailable — describe the stored terms without inventing values)";
    }

    const sections: string[] = [
      `# Diplomat's Briefing\n${input.briefing || "(no briefing provided)"}`,
    ];

    if (input.activeProposal) {
      sections.push(formatActiveProposal(input.activeProposal));
      sections.push(
        "Decide on this on-the-table deal: accept-deal, propose-counter-deal (a counter), or reject-deal."
      );
    } else {
      if (ownPending) {
        sections.push(
          `# Note\nYour side's proposal #${reduction.active!.ID} is still awaiting the counterpart's reply — there is nothing new to put on the table until they respond.`
        );
      }
      sections.push(`# Strategic Intent\n${input.intent || "(open a deal at your discretion)"}`);
      sections.push(
        "There is no deal from the counterpart on the table. Construct opening terms with propose-counter-deal (the tradable range and values below are your basis)."
      );
    }

    sections.push(`# Inspection (advisory)\n${inspectionBlock}`);

    return [
      ...buildGameContextMessages(parameters),
      { role: "user", content: sections.join("\n\n") },
    ];
  }

  /** Summarize the move recorded by the terminal tool for the diplomat to reason over and voice. */
  public override async getOutput(
    _parameters: StrategistParameters,
    input: NegotiatorInput,
    _finalText: string
  ): Promise<string | undefined> {
    return input.outcome ? summarizeMove(input.outcome) : undefined;
  }
}
