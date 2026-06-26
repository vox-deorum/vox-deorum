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
  computeValueMaps,
  enactAgentDeal,
  requireCurrentOpenProposal,
  requireNoOpenProposal,
  IllegalDealError,
  type InspectDealResult,
  type EnactDealResult,
} from "../../utils/diplomacy/deal.js";
import { identityOf } from "../../utils/diplomacy/transcript-utils.js";
import {
  formatDealTermsByDirection,
  formatEstimate,
  formatPromiseLabel,
  isSentinel,
  itemTypeLabel,
} from "../../utils/diplomacy/deal-format.js";
import { jsonToMarkdown } from "../../utils/tools/json-to-markdown.js";
import {
  LedgerTermSchema,
  resolveLedger,
  formatResolutionErrors,
} from "./ledger-resolver.js";
import {
  durationForItemType,
  durationForPromiseType,
  AGREEMENT_METADATA,
  PROMISE_METADATA,
  PROMISE_TYPES,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
import type {
  DealDurations,
  DealPayload,
  PromiseTerm,
  TradeItem,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
import type { NormalizedSideRange } from "../../../../mcp-server/dist/tools/knowledge/inspect-deal.js";

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
  /**
   * The upfront `inspect-deal` result (tradable range + promise targets) computed in
   * `getInitialMessages`. The `propose-deal` tool reads it to resolve the authored Give/Take NAMES
   * back into IDs without re-inspecting. Absent when the upfront inspection failed.
   */
  upfrontInspection?: InspectDealResult;
  /** Set by the terminal tool the negotiator calls. */
  outcome?: NegotiatorMove;
}

/** A seat → civ-name resolver from the thread's stored identities ("Player <id>" fallback). */
function civNameFor(thread: EnvoyThread): (playerID: number) => string {
  return (id: number) => identityOf(thread, id)?.name ?? `Player ${id}`;
}

/** The negotiator's own seat and its counterpart (the other endpoint of the thread). */
function endpoints(thread: EnvoyThread): { agentID: number; counterpartID: number } {
  const agentID = thread.agent;
  const counterpartID = thread.player1ID === agentID ? thread.player2ID : thread.player1ID;
  return { agentID, counterpartID };
}

/** A bare advisory-value phrase ("worth ~N to <civ>" / "no usable estimate"), or "" when absent. */
function bareValue(value: number | undefined, receiverName: string): string {
  if (value === undefined) return "";
  return isSentinel(value) ? "no usable estimate" : `worth ~${Math.round(value)} to ${receiverName}`;
}

/** Parenthesize comma-separated row details, omitting absent/empty details. */
function detailClause(...details: Array<string | undefined>): string {
  const present = details.filter((detail): detail is string => !!detail);
  return present.length ? ` (${present.join(", ")})` : "";
}

/** A parenthesized advisory-value clause for a menu row, or "" when no estimate is available. */
function valueClause(value: number | undefined, receiverName: string): string {
  return detailClause(bareValue(value, receiverName));
}

/** A bare "lasts N turn(s)" phrase for a turn count (singular-aware). */
function lastsTurns(turns: number): string {
  return `lasts ${turns} ${turns === 1 ? "turn" : "turns"}`;
}

/** A bare "lasts N turns" phrase for a duration-bearing item type, or "" when the type carries none. */
function durationPhrase(itemType: TradeItem["itemType"], durations: DealDurations): string {
  const turns = durationForItemType(itemType, durations);
  return turns !== undefined ? lastsTurns(turns) : "";
}

/**
 * A bare term-length phrase for a promise. Every offered promise is one the tactical AI honors, so
 * there is no enforcement caveat. 
 */
function renderPromiseDuration(promiseType: PromiseTerm["promiseType"], turns: number | undefined): string {
  if (promiseType === "COOP_WAR") {
    return turns !== undefined ? `war begins in ${turns} turns` : "war begins after a short preparation";
  }
  return turns !== undefined ? lastsTurns(turns) : "lasts until broken";
}

/** Append a "## <title>" block when it has rows. */
function pushMenuCategory(into: string[], title: string, rows: string[]): void {
  if (rows.length > 0) into.push(`## ${title}`, ...rows);
}

/**
 * The "Agreements" menu rows, derived from the canonical {@link AGREEMENT_METADATA} (single source of
 * truth for label / order / mutuality). Single-shot toggles show their advisory value; the four mutual
 * pacts are tagged "(Mutual)" and listed once (they bind both sides). `key` indexes the side range's
 * toggle candidates.
 */
const AGREEMENT_ROWS: ReadonlyArray<{
  key: keyof NormalizedSideRange;
  label: string;
  itemType: TradeItem["itemType"];
  mutual: boolean;
}> = AGREEMENT_METADATA.map((a) => ({
  key: a.rangeKey as keyof NormalizedSideRange,
  label: a.label,
  itemType: a.itemType,
  mutual: a.mutual,
}));

/**
 * The untargeted promises offered (label + promise type, for the term-length clause), derived from the
 * canonical {@link PROMISE_METADATA}: the promises that are offered (the tactical AI honors them) and
 * carry no third-party target. Spy / No-Convert / Bully-CS / Attack-CS fall out automatically (not
 * offered); Coop War is offered but targeted, so it gets its own row below.
 */
const UNTARGETED_PROMISE_ROWS: ReadonlyArray<{ label: string; promiseType: PromiseTerm["promiseType"] }> =
  PROMISE_TYPES.filter((t) => PROMISE_METADATA[t].offered && !PROMISE_METADATA[t].targeted).map((t) => ({
    label: PROMISE_METADATA[t].label,
    promiseType: t,
  }));

/**
 * Render one side's tradable range as a first-person "What <Giver> Can Give" menu (only legal terms),
 * with the friendly term labels and entity NAMES the `propose-deal` tool expects, plus advisory value
 * (to the receiver), available counts, net income, and city population/HP. `receiverName` frames the
 * advisory values; `promiseTargets` drives the targeted-promise rows.
 */
function formatSideMenu(
  range: NormalizedSideRange | undefined,
  giverID: number,
  receiverID: number,
  giverName: string,
  receiverName: string,
  subline: string,
  promiseTargets: InspectDealResult["promiseTargets"],
  durations: DealDurations
): string {
  const head = `# What ${giverName} Can Give`;
  if (!range) return `${head}\n- ${subline}\n(menu unavailable)`;
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
  const agreementRows = AGREEMENT_ROWS.flatMap(({ key, label, itemType, mutual }) => {
    const cand = range[key] as NormalizedSideRange["maps"] | undefined;
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
  const peaceDur = durationPhrase("THIRD_PARTY_PEACE", durations);
  const tpRows = [
    ...range.thirdPartyPeace
      .filter((t) => t.legal)
      .map((t) => `- Third-Party Peace with ${t.name ?? `team ${t.teamID}`}${detailClause(
        peaceDur,
        bareValue(t.valueToReceiver, receiverName)
      )}`),
    ...range.thirdPartyWar
      .filter((t) => t.legal)
      .map((t) => `- Third-Party War on ${t.name ?? `team ${t.teamID}`}${valueClause(t.valueToReceiver, receiverName)}`),
  ];
  pushMenuCategory(out, "Third-Party Peace & War", tpRows);

  // Promises: the untargeted ones (with their term length), plus Coop War listing eligible major
  // target NAMES and its preparation countdown. Only AI-honored promises are offered.
  const promiseRows = UNTARGETED_PROMISE_ROWS.map(
    ({ label, promiseType }) =>
      `- ${label}${detailClause(renderPromiseDuration(promiseType, durationForPromiseType(promiseType, durations)))}`
  );
  const coopNames = (promiseTargets ?? [])
    .filter((t) => t.kind === "major" && t.coopWarEligible !== false)
    .map((t) => t.name ?? `player ${t.playerID}`);
  if (coopNames.length) {
    promiseRows.push(`- ${PROMISE_METADATA.COOP_WAR.label}${detailClause(
      `targets: ${coopNames.join(", ")}`,
      renderPromiseDuration("COOP_WAR", durationForPromiseType("COOP_WAR", durations))
    )}`);
  }
  pushMenuCategory(out, "Promises", promiseRows);

  return out.join("\n");
}

/**
 * Format the full first-person Give/Take ledger menu (context 2): what the negotiator's civ can GIVE
 * (its own tradable range) and what it can TAKE (the counterpart's range). Names and labels here are
 * exactly what the `propose-deal` tool expects, so this menu is a faithful template for the schema.
 */
export function formatGiveTakeLedger(inspection: InspectDealResult, thread: EnvoyThread): string {
  const { agentID, counterpartID } = endpoints(thread);
  const name = civNameFor(thread);
  const agentName = name(agentID);
  const counterpartName = name(counterpartID);
  const give = formatSideMenu(
    inspection.tradableRange[String(agentID)],
    agentID,
    counterpartID,
    agentName,
    counterpartName,
    `Potential terms YOUR civ can give ${counterpartName}`,
    inspection.promiseTargets,
    inspection
  );
  const take = formatSideMenu(
    inspection.tradableRange[String(counterpartID)],
    counterpartID,
    agentID,
    counterpartName,
    agentName,
    `Potential terms ${counterpartName} can give YOUR civ`,
    inspection.promiseTargets,
    inspection
  );
  return [
    "Send NAMES exactly as written below; never numbers. Durations and vote counts are fixed by the game.",
    give,
    take,
  ].join("\n\n");
}

/** Format the upfront on-the-table inspection (per-term legality + value, promise agreeability). */
export function formatInspection(inspection: InspectDealResult): string {
  const sections: string[] = [];

  if (inspection.items.length > 0) {
    const lines = inspection.items.map((it, i) => {
      const legal = it.legality ? "legal" : `ILLEGAL (${it.reasons.join("; ") || "no reason given"})`;
      // Values are the stock AI's advisory estimate; a maxed-out estimate renders "no usable estimate".
      return `  [${i}] ${itemTypeLabel(it.itemType)}: ${it.fromPlayerID} to ${it.toPlayerID}, ${legal}; value if I give = ${formatEstimate(it.valueIfIGive)}, value if I receive = ${formatEstimate(it.valueIfIReceive)}`;
    });
    sections.push(`### On-the-table trade items (per-term legality + AI value, advisory)\n${lines.join("\n")}`);
  }

  // Model context — render as markdown, never JSON (see utils/tools/json-to-markdown).
  if (inspection.promises.length > 0) {
    sections.push(
      `### On-the-table promises (agreeability factors, advisory)\n${jsonToMarkdown(inspection.promises)}`
    );
  }

  return sections.length > 0 ? sections.join("\n\n") : "(no on-the-table terms to inspect)";
}

/**
 * Friendly label for an on-the-table item, resolving resource/city/tech/team/vote IDs to NAMES via
 * the inspection range. Duration-bearing terms append their stamped, fixed term length ("lasts N
 * turns") off the item's own `duration` (set server-side by `applyDealDurations`).
 */
function namedItemLabel(item: TradeItem, inspection?: InspectDealResult): string {
  const giverRange = inspection?.tradableRange[String(item.fromPlayerID)];
  const dur = item.duration ? ` (lasts ${item.duration} turns)` : "";
  switch (item.itemType) {
    case "GOLD":
      return `Gold: ${item.amount ?? 0}`;
    case "GOLD_PER_TURN":
      return `Gold Per Turn: ${item.amount ?? 0}${dur}`;
    case "RESOURCES": {
      const r = giverRange?.resources.find((x) => x.resourceID === item.resourceID);
      return `Resource: ${r?.name ?? `#${item.resourceID}`} x${item.quantity ?? 1}${dur}`;
    }
    case "CITIES": {
      const c = giverRange?.cities.find((x) => x.cityID === item.cityID);
      return `City: ${c?.name ?? `#${item.cityID}`}`;
    }
    case "TECHS": {
      const t = giverRange?.techs.find((x) => x.techID === item.techID);
      return `Technology: ${t?.name ?? `#${item.techID}`}`;
    }
    case "THIRD_PARTY_PEACE": {
      const t = giverRange?.thirdPartyPeace.find((x) => x.teamID === item.thirdPartyTeamID);
      return `Third-Party Peace with ${t?.name ?? `team ${item.thirdPartyTeamID}`}${dur}`;
    }
    case "THIRD_PARTY_WAR": {
      const t = giverRange?.thirdPartyWar.find((x) => x.teamID === item.thirdPartyTeamID);
      return `Third-Party War on ${t?.name ?? `team ${item.thirdPartyTeamID}`}`;
    }
    case "VOTE_COMMITMENT": {
      const v = giverRange?.voteCommitments.find(
        (x) => x.resolutionID === item.resolutionID && x.voteChoice === item.voteChoice && !!x.repeal === !!item.repeal
      );
      return `Vote Commitment: ${v?.name ?? `resolution ${item.resolutionID}`}`;
    }
    default:
      return `${itemTypeLabel(item.itemType)}${dur}`;
  }
}

/** Format the on-the-table proposed terms (context 3) first-person: what each side offers to give. */
export function formatActiveProposalLedger(
  active: ActiveProposalContext,
  thread: EnvoyThread,
  inspection?: InspectDealResult
): string {
  const { agentID, counterpartID } = endpoints(thread);
  const name = civNameFor(thread);
  const deal = active.deal;
  const directionRows = (giverID: number, receiverID: number): string[] => [
    ...deal.items
      .filter((i) => i.fromPlayerID === giverID && i.toPlayerID === receiverID)
      .map((i) => `- ${namedItemLabel(i, inspection)}`),
    ...deal.promises
      .filter((p) => p.promiserID === giverID && p.recipientID === receiverID)
      // The stamped `duration` carries the fixed term length (set server-side); render it the same
      // way the menu does (Coop War "war begins in N turns", others "lasts N turns" / "indefinitely").
      .map((p) => `- ${formatPromiseLabel(p)}${detailClause(renderPromiseDuration(p.promiseType, p.duration))}`),
  ];
  const lines = [`# Deal On The Table (proposal message #${active.messageID})`];
  const give = directionRows(agentID, counterpartID);
  const take = directionRows(counterpartID, agentID);
  if (give.length) lines.push(`## ${name(agentID)} Offers To Give ${name(counterpartID)}`, ...give);
  if (take.length) lines.push(`## ${name(counterpartID)} Offers To Give ${name(agentID)}`, ...take);
  if (deal.message) lines.push(`Their one-sentence line: "${deal.message}"`);
  return lines.join("\n");
}

/**
 * Reframe an {@link IllegalDealError} (one `"ITEM_TYPE (from→to): reason"` line per untradeable item)
 * into first-person Give/Take feedback the model can act on. A reason whose giver is the negotiator's
 * own seat is a Give; otherwise it is a Take. No deal was written, so the model can adjust and retry.
 */
function formatIllegalDealError(error: IllegalDealError, agentID: number): string {
  const lines = error.reasons.map((r) => {
    const m = r.match(/^(\w+)\s*\((\d+)\s*→\s*(\d+)\):\s*(.*)$/);
    if (!m) return `- ${r}`;
    const [, itemType, from, , reason] = m;
    const side = Number(from) === agentID ? "Give" : "Take";
    return `- [${side}] ${itemTypeLabel(itemType)}: ${reason}`;
  });
  return ["This deal can't be made. Adjust these terms and try again:", ...lines].join("\n");
}

/** Render a newly authored deal's terms and proposal-time estimates for the diplomat. */
function summarizeAuthoredDeal(
  move: Extract<NegotiatorMove, { type: "propose" | "counter" }>,
  thread: EnvoyThread
): string {
  // Fresh proposal-time inspection gives per-item values; fold them into the direction-grouped terms.
  const maps = move.inspection ? computeValueMaps(move.inspection, thread.player1ID, thread.player2ID) : undefined;
  const terms = formatDealTermsByDirection(
    move.deal,
    maps?.value1,
    maps?.value2,
    thread.player1ID,
    thread.player2ID,
    civNameFor(thread),
    thread.agent
  );
  const lines = [terms || "(no terms)"];
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
            args.Message,
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
