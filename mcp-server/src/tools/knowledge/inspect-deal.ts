/**
 * Read-only `inspect-deal` tool.
 *
 * For a pair of major civs and an optional constructed deal (including an empty deal),
 * returns in one call (specs.md §3, §6):
 *  - the full tradable range each side could put on the table (so the Web deal screen
 *    can render like the in-game trade screen);
 *  - per trade term: structural legality + reasons (computed under the same
 *    bTreatAsHumanToHuman = true semantics as stage-6 enactment) and the AI value
 *    estimate BOTH directions (worth if I give it vs. if I receive it);
 *  - per promise term: agreeability factors — the raw decision inputs the negotiator
 *    reasons over — assembled from existing diplomacy getters (get-opinions /
 *    get-players / get-diplomatic-events), since no in-game promise valuation exists.
 *
 * Everything is advisory; it gates nothing (specs.md §4). The deal is inspected
 * against live game state via a transient scratch deal that is never activated, so
 * the call leaves no trace. Legality/reasons are never stored — they are fetched
 * fresh from here whenever needed.
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { getTool } from "../index.js";
import { stripTags } from "../../utils/database/localized.js";
import { inspectDeal, type InspectedItem, type SideRange } from "../../utils/lua/inspect-deal.js";
import { DealPayloadSchema, PROMISE_TYPES, type PromiseTerm, type TradeItem } from "../../utils/deal-schema.js";

/** Coerce a value that may arrive as an empty Lua table ({} instead of []). */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Normalize a DLL reason string (color/newline tags) into discrete reason lines. */
function parseReasons(reason: string | undefined): string[] {
  if (!reason) return [];
  const cleaned = stripTags(reason);
  if (!cleaned) return [];
  return cleaned
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Ensure a directed term is between the two inspected players. */
function isDirectedPair(fromPlayerID: number, toPlayerID: number, playerAID: number, playerBID: number): boolean {
  return (
    (fromPlayerID === playerAID && toPlayerID === playerBID) ||
    (fromPlayerID === playerBID && toPlayerID === playerAID)
  );
}

/** Reject malformed deal terms before the Lua layer derives any implied receiver. */
function validateDealParticipants(playerAID: number, playerBID: number, items: TradeItem[], promises: PromiseTerm[]): void {
  for (const [index, item] of items.entries()) {
    if (!isDirectedPair(item.fromPlayerID, item.toPlayerID, playerAID, playerBID)) {
      throw new Error(`ProposedDeal.items[${index}] must be directed between PlayerAID and PlayerBID`);
    }
    if (item.itemType === "CITIES" && (item.cityID === undefined || item.cityID < 0)) {
      throw new Error(`ProposedDeal.items[${index}] with itemType CITIES must include a non-negative cityID`);
    }
  }

  for (const [index, promise] of promises.entries()) {
    if (!isDirectedPair(promise.promiserID, promise.recipientID, playerAID, playerBID)) {
      throw new Error(`ProposedDeal.promises[${index}] must be directed between PlayerAID and PlayerBID`);
    }
  }
}

/** Input schema for the inspect-deal tool. */
const InspectDealInputSchema = z.object({
  PlayerAID: z.number().int().min(0).max(MaxMajorCivs - 1).describe("One major-civ player ID"),
  PlayerBID: z.number().int().min(0).max(MaxMajorCivs - 1).describe("The other major-civ player ID"),
  ProposedDeal: DealPayloadSchema.optional().describe(
    "Optional constructed deal to evaluate (items + promises). Omit or pass an empty deal to get the tradable range only."
  ),
});

/** Per-trade-term result. */
const InspectedTradeItemSchema = z.object({
  fromPlayerID: z.number(),
  toPlayerID: z.number(),
  itemType: z.string(),
  legality: z.boolean(),
  reasons: z.array(z.string()).describe("Reasons it is untradeable (empty when legal)"),
  valueIfIGive: z.number().describe("AI value to the giver of parting with it (advisory; may be INT_MAX)"),
  valueIfIReceive: z.number().describe("AI value to the receiver of gaining it (advisory; may be INT_MAX)"),
});

/** Per-promise-term result. */
const InspectedPromiseSchema = z.object({
  promiserID: z.number(),
  recipientID: z.number(),
  promiseType: z.enum(PROMISE_TYPES),
  targetPlayerID: z.number().optional(),
  duration: z.number().optional(),
  agreeabilityFactors: z.object({
    promiserOpinionOfRecipient: z.array(z.string()).optional(),
    recipientOpinionOfPromiser: z.array(z.string()).optional(),
    recentDiplomaticEvents: z.any().describe("Recent diplomatic events between the two sides (formatted, by turn)"),
    note: z.string(),
  }),
});

/** Output schema. */
const InspectDealOutputSchema = z.object({
  items: z.array(InspectedTradeItemSchema),
  promises: z.array(InspectedPromiseSchema),
  tradableRange: z.record(z.string(), z.any()).describe("Per side (keyed by player ID): the full range it could put on the table"),
});

/**
 * Tool that inspects a proposed/empty deal: legality + value for trade items,
 * agreeability factors for promises, plus the tradable range per side.
 */
class InspectDealTool extends ToolBase {
  readonly name = "inspect-deal";

  readonly description =
    "Read-only inspection of a draft deal and potential options between two major civs, including evaluated values.";

  readonly inputSchema = InspectDealInputSchema;

  readonly outputSchema = InspectDealOutputSchema;

  readonly annotations: ToolAnnotations = { readOnlyHint: true };

  readonly metadata = {
    autoComplete: ["PlayerAID", "PlayerBID"],
  };

  /** Execute a read-only deal inspection against the current game state. */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const { PlayerAID, PlayerBID, ProposedDeal } = args;

    if (PlayerAID === PlayerBID) {
      throw new Error("The two players must be distinct");
    }

    const proposedItems = ProposedDeal?.items ?? [];
    const promises = ProposedDeal?.promises ?? [];
    validateDealParticipants(PlayerAID, PlayerBID, proposedItems, promises);

    // 1) Trade items + tradable range, via the in-game scratch deal.
    const inspection = await inspectDeal(PlayerAID, PlayerBID, proposedItems);
    if (!inspection) {
      throw new Error("inspect-deal: the game could not inspect the deal (no scratch deal or bridge failure)");
    }

    const items = asArray<InspectedItem>(inspection.items).map((it) => {
      const parsedReasons = parseReasons(it.reason);
      const reasons = it.unknown
        ? [`Unknown item type: ${it.itemType}`]
        : it.legal
          ? []
          : parsedReasons.length > 0
            ? parsedReasons
            : ["Not tradeable under current game state (the game provided no specific reason)."];
      return {
        fromPlayerID: it.fromPlayerID,
        toPlayerID: it.toPlayerID,
        itemType: it.itemType,
        legality: !!it.legal,
        reasons,
        valueIfIGive: it.valueToGiver ?? 0,
        valueIfIReceive: it.valueToReceiver ?? 0,
      };
    });

    // Normalize the per-side range arrays (empty Lua tables may arrive as {}).
    const tradableRange: Record<string, unknown> = {};
    for (const [pid, raw] of Object.entries(inspection.range ?? {})) {
      const side = raw as Partial<SideRange>;
      tradableRange[pid] = {
        ...side,
        resources: asArray(side.resources),
        cities: asArray(side.cities),
        techs: asArray(side.techs),
        thirdPartyPeace: asArray(side.thirdPartyPeace),
        thirdPartyWar: asArray(side.thirdPartyWar),
      };
    }

    // 2) Promise agreeability factors, assembled from existing diplomacy getters.
    const inspectedPromises = await this.inspectPromises(promises);

    return {
      items,
      promises: inspectedPromises,
      tradableRange,
    };
  }

  /**
   * Assemble advisory agreeability factors for each promise term from existing
   * diplomacy getters. Opinions/events are per-perspective, so we fetch once per
   * unique promiser and slice out the recipient-specific signal. No DLL verdict is
   * computed (specs.md §6 out-of-scope) — these are the raw inputs the negotiator
   * reasons over.
   */
  private async inspectPromises(promises: PromiseTerm[]): Promise<z.infer<typeof InspectedPromiseSchema>[]> {
    if (promises.length === 0) return [];

    const getOpinions = getTool("getOpinions");
    const getDiplomaticEvents = getTool("getDiplomaticEvents");

    // Cache per-promiser getter results to avoid duplicate work.
    const opinionsCache = new Map<number, Record<string, unknown>>();
    const eventsCache = new Map<string, unknown>();

    const opinionsFor = async (promiserID: number): Promise<Record<string, unknown>> => {
      if (!opinionsCache.has(promiserID)) {
        const result = getOpinions ? ((await getOpinions.execute({ PlayerID: promiserID })) as Record<string, unknown>) : {};
        opinionsCache.set(promiserID, result ?? {});
      }
      return opinionsCache.get(promiserID)!;
    };
    const eventsFor = async (promiserID: number, recipientID: number): Promise<unknown> => {
      const key = `${promiserID}->${recipientID}`;
      if (!eventsCache.has(key)) {
        const result = getDiplomaticEvents
          ? await getDiplomaticEvents.execute({ PlayerID: promiserID, OtherPlayerID: recipientID, Formatted: true })
          : {};
        eventsCache.set(key, result ?? {});
      }
      return eventsCache.get(key);
    };

    const results: z.infer<typeof InspectedPromiseSchema>[] = [];
    for (const p of promises) {
      const opinions = await opinionsFor(p.promiserID);
      const recipientEntry = opinions[String(p.recipientID)] as
        | { OurOpinionOfThem?: string[]; TheirOpinionOfUs?: string[] }
        | string
        | undefined;
      const events = await eventsFor(p.promiserID, p.recipientID);

      const factors: z.infer<typeof InspectedPromiseSchema>["agreeabilityFactors"] = {
        promiserOpinionOfRecipient: typeof recipientEntry === "object" ? recipientEntry?.OurOpinionOfThem : undefined,
        recipientOpinionOfPromiser: typeof recipientEntry === "object" ? recipientEntry?.TheirOpinionOfUs : undefined,
        recentDiplomaticEvents: events,
        note: "Advisory raw decision inputs (approach, opinion, trust, broken/ignored-promise history, victory competition). No in-game promise valuation exists; the negotiator reasons over these. This gates nothing.",
      };

      results.push({
        promiserID: p.promiserID,
        recipientID: p.recipientID,
        promiseType: p.promiseType,
        targetPlayerID: p.targetPlayerID,
        duration: p.duration,
        agreeabilityFactors: factors,
      });
    }
    return results;
  }
}

/** Creates a new instance of the inspect-deal tool. */
export default function createInspectDealTool() {
  return new InspectDealTool();
}
