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
  IllegalDealError,
  type InspectDealResult,
  type EnactDealResult,
} from "../../utils/diplomacy/deal.js";
import {
  isSentinel,
  itemTypeLabel,
} from "../../../../mcp-server/dist/utils/deal-format.js";
import {
  LedgerTermSchema,
  resolveLedger,
  formatResolutionErrors,
} from "./ledger-resolver.js";
import {
  durationForPromiseType,
  AGREEMENT_METADATA,
  PROMISE_METADATA,
  PROMISE_TYPES,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
import type {
  DealDurations,
  DealPayload,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
import type { NormalizedSideRange } from "../../../../mcp-server/dist/tools/knowledge/inspect-deal.js";
import type { PlayersReport } from "../../../../mcp-server/dist/tools/knowledge/get-players.js";
import {
  civNameFor,
  detailClause,
  durationPhrase,
  endpoints,
  formatDealLedger,
  ledgerContextFor,
  renderPromiseDuration,
  thirdPartyRelationshipBullets,
  type DealLedgerOptions,
} from "./deal-ledger.js";

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

/** A bare advisory-value phrase ("worth ~N to <civ>" / "no usable estimate"), or "" when absent. */
function bareValue(value: number | undefined, receiverName: string): string {
  if (value === undefined) return "";
  return isSentinel(value) ? "no usable estimate" : `worth ~${Math.round(value)} to ${receiverName}`;
}

/** A parenthesized advisory-value clause for a menu row, or "" when no estimate is available. */
function valueClause(value: number | undefined, receiverName: string): string {
  return detailClause(bareValue(value, receiverName));
}

/** Append a "## <title>" block when it has rows. */
function pushMenuCategory(into: string[], title: string, rows: string[]): void {
  if (rows.length > 0) into.push(`### ${title}\n`, ...rows);
}

/**
 * Render one side's tradable range as a first-person "What <Giver> Can Give" menu (only legal terms),
 * with the friendly term labels and entity NAMES the `propose-deal` tool expects, plus advisory value
 * (to the receiver), available counts, net income, and city population/HP. `receiverName` frames the
 * advisory values; `promiseTargets` drives the targeted-promise rows.
 */
function formatSideMenu(
  range: NormalizedSideRange,
  giverName: string,
  receiverName: string,
  subline: string,
  promiseTargets: InspectDealResult["promiseTargets"],
  durations: DealDurations,
  relBullets?: (targetName: string) => string[]
): string {
  const head = `## What ${giverName} Can Give`;
  const out: string[] = [head, `- ${subline}`];

  // Gold + gold per turn (net income shows how much GPT the side can sustain; GPT runs for a term).
  const goldRows: string[] = [];
  if (range.gold.available) goldRows.push(`- Gold (up to ${range.gold.max})`);
  if (range.goldPerTurn.available) {
    goldRows.push(`- Gold Per Turn${detailClause(
      range.netGoldPerTurn !== undefined ? `${giverName}'s net income: ${range.netGoldPerTurn}/turn` : undefined,
      durationPhrase("GOLD_PER_TURN", durations)
    )}`);
  }
  pushMenuCategory(out, "Gold", goldRows);

  // Resources, bucketed luxury then strategic (count + duration + advisory value).
  const resourceRows = (category: "luxury" | "strategic"): string[] =>
    range.resources
      .filter((r) => r.legal && r.category === category)
      .map((r) => {
        return `- ${r.name ?? `Resource #${r.resourceID}`}${detailClause(
          `${r.quantityAvailable} available`,
          durationPhrase("RESOURCES", durations),
          bareValue(r.valueToReceiver, receiverName)
        )}`;
      });
  pushMenuCategory(out, "Luxury Resources", resourceRows("luxury"));
  pushMenuCategory(out, "Strategic Resources", resourceRows("strategic"));

  // World Congress vote commitments (votes + advisory value).
  const voteRows = range.voteCommitments
    .filter((v) => v.legal)
    .map((v) => {
      return `- ${v.name ?? `Resolution #${v.resolutionID}`}${detailClause(
        `${v.numVotes} ${v.numVotes === 1 ? "vote" : "votes"}`,
        bareValue(v.valueToReceiver, receiverName)
      )}`;
    });
  pushMenuCategory(out, "World Congress", voteRows);

  // Agreements: single-shot toggles + the four mutual pacts (tagged). Each shows its fixed term
  // length where it carries one; mutual pacts are tagged and omit the (symmetric) advisory value.
  const agreementRows = AGREEMENT_METADATA.flatMap(({ rangeKey, label, itemType, mutual }) => {
    const cand = range[rangeKey as keyof NormalizedSideRange] as NormalizedSideRange["maps"] | undefined;
    if (!cand?.legal) return [];
    return [`- ${label}${detailClause(
      mutual ? "Mutual" : undefined,
      durationPhrase(itemType, durations),
      mutual ? undefined : bareValue(cand.valueToReceiver, receiverName)
    )}`];
  });
  pushMenuCategory(out, "Agreements", agreementRows);

  // Cities (population + HP + advisory value).
  const cityRows = range.cities
    .filter((c) => c.legal)
    .map((c) => {
      return `- ${c.name}${detailClause(
        c.population !== undefined ? `Population ${c.population}` : undefined,
        c.hitPoints !== undefined && c.maxHitPoints !== undefined ? `HP ${c.hitPoints}/${c.maxHitPoints}` : undefined,
        bareValue(c.valueToReceiver, receiverName)
      )}`;
    });
  pushMenuCategory(out, "Cities", cityRows);

  // Technologies.
  const techRows = range.techs
    .filter((t) => t.legal)
    .map((t) => `- ${t.name ?? `Tech #${t.techID}`}${valueClause(t.valueToReceiver, receiverName)}`);
  pushMenuCategory(out, "Technologies", techRows);

  // Third-party peace & war (target civ names + advisory value; peace runs for the peace-deal term).
  // Each legal target trails the two sides' public relationship to it (relBullets), indented.
  const peaceDur = durationPhrase("THIRD_PARTY_PEACE", durations);
  const tpBullets = (name: string | undefined): string[] => (name ? relBullets?.(name) ?? [] : []);
  const tpRows = [
    ...range.thirdPartyPeace
      .filter((t) => t.legal)
      .flatMap((t) => [
        `- Third-Party Peace with ${t.name ?? `team ${t.teamID}`}${detailClause(
          peaceDur,
          bareValue(t.valueToReceiver, receiverName)
        )}`,
        ...tpBullets(t.name),
      ]),
    ...range.thirdPartyWar
      .filter((t) => t.legal)
      .flatMap((t) => [
        `- Third-Party War on ${t.name ?? `team ${t.teamID}`}${valueClause(t.valueToReceiver, receiverName)}`,
        ...tpBullets(t.name),
      ]),
  ];
  pushMenuCategory(out, "Third-Party Peace & War", tpRows);

  // Promises: the untargeted ones (with their term length), plus Coop War listing eligible major
  // target NAMES and its preparation countdown. Only AI-honored promises are offered.
  const promiseRows = PROMISE_TYPES.filter((t) => !PROMISE_METADATA[t].targeted).map(
    (promiseType) =>
      `- ${PROMISE_METADATA[promiseType].label}${detailClause(renderPromiseDuration(promiseType, durationForPromiseType(promiseType, durations)))}`
  );
  const coopTargets = (promiseTargets ?? []).filter((t) => t.kind === "major" && t.coopWarEligible !== false);
  if (coopTargets.length) {
    promiseRows.push(`- ${PROMISE_METADATA.COOP_WAR.label}${detailClause(
      `targets: ${coopTargets.map((t) => t.name ?? `player ${t.playerID}`).join(", ")}`,
      renderPromiseDuration("COOP_WAR", durationForPromiseType("COOP_WAR", durations))
    )}`);
    for (const t of coopTargets) promiseRows.push(...tpBullets(t.name));
  }
  pushMenuCategory(out, "Promises", promiseRows);

  return out.join("\n").trim();
}

/**
 * Format the full first-person Give/Take ledger menu (context 2): what the negotiator's civ can GIVE
 * (its own tradable range) and what it can TAKE (the counterpart's range). Names and labels here are
 * exactly what the `propose-deal` tool expects, so this menu is a faithful template for the schema.
 */
export function formatGiveTakeLedger(
  inspection: InspectDealResult,
  thread: EnvoyThread,
  players?: PlayersReport
): string {
  const { agentID, counterpartID } = endpoints(thread);
  const name = civNameFor(thread);
  const ctx = ledgerContextFor(thread);
  // Menu sub-bullets carry only the public relationship status (no set-relationship directive;
  // that stays a deal-ledger detail), indented two spaces under the third-party candidate row.
  const relBullets = (targetName: string) =>
    thirdPartyRelationshipBullets(targetName, ctx, players, { indent: "  " });
  const agentName = name(agentID);
  const counterpartName = name(counterpartID);
  const give = formatSideMenu(
    inspection.tradableRange[String(agentID)],
    agentName,
    counterpartName,
    `Potential terms ${agentName} (YOUR civ) can give ${counterpartName}`,
    inspection.promiseTargets,
    inspection,
    relBullets
  );
  const take = formatSideMenu(
    inspection.tradableRange[String(counterpartID)],
    counterpartName,
    agentName,
    `Potential terms ${counterpartName} can give ${agentName} (YOUR civ)`,
    inspection.promiseTargets,
    inspection,
    relBullets
  );
  return [
    "Send NAMES exactly as written below. Term durations or vote counts are fixed.",
    give,
    take,
  ].join("\n\n").trim();
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
          ? "This deal was already agreed earlier."
          : "The agreement has been recorded" +
            (move.enact.enacted ? " and enacted." : " (in-game enactment lands in stage 6)."),
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
        "Accept the deal on the table exactly as-is. Provide your inward rationale for the diplomat and a single-sentence outward message to be voiced. The agreement is recorded and routed to enactment. Use only when a deal is on the table.",
      inputSchema: z.object({
        rationale: z.string().describe("Inward reasoning for the diplomat (not voiced verbatim)."),
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
            rationale: args.rationale,
            message: args.Message,
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
        "Author the deal terms to present: a counter to the deal on the table, or an opening proposal when none is on the table. Author by NAME using two lists, Give (what your civ gives the counterpart) and Take (what the counterpart gives your civ), copying term labels and names exactly from the GIVE/TAKE menu. Provide an inward rationale for the diplomat and a single-sentence outward message to be voiced.",
      inputSchema: z.object({
        Rationale: z.string().describe("Inward reasoning for the diplomat (not voiced verbatim)."),
        Message: z
          .string()
          .describe("One single sentence the diplomat will voice to the counterpart."),
        Give: z
          .array(LedgerTermSchema)
          .default([])
          .describe(
            "Terms YOUR civ gives the counterpart. Use NAMES from the GIVE menu. Durations are fixed by the game."
          ),
        Take: z
          .array(LedgerTermSchema)
          .default([])
          .describe("Terms the counterpart gives YOUR civ. Use NAMES from the TAKE menu."),
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
        "Reject the deal on the table exactly as-is. Provide your inward rationale for the diplomat and a single-sentence outward message to be voiced. Use only when a deal is on the table.",
      inputSchema: z.object({
        rationale: z.string().describe("Inward reasoning for the diplomat (not voiced verbatim)."),
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
          // The outward Message is recorded as the deal-reject row's Content so the UI surfaces it as
          // the diplomat's reply in the rejection notice (reject rows reduce to the proposal's status).
          const { id } = await appendDealReject(
            ni.thread,
            ni.thread.agent,
            args.Message,
            ni.activeProposal.messageID
          );
          ni.outcome = {
            type: "reject",
            rationale: args.rationale,
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
