/**
 * @module envoy/utils/ledger-resolver
 *
 * Turns the negotiator's first-person Give/Receive ledger into the directed, ID-bearing
 * {@link AuthoredTradeItem}/{@link PromiseTerm} arrays the deal store consumes.
 *
 * The negotiator authors deals as two lists of PLAIN STRINGS (`Give` = its own civ gives the
 * counterpart; `Receive` = the counterpart gives its civ). Each string is parsed by the string grammar in
 * `./ledger-grammar.ts` ({@link parseEntry}) into a canonical label + optional name/amount. This module
 * then classifies that against the upfront `inspect-deal` tradable range (the same menu the model was
 * shown), resolves entity names to IDs, and reports precise, correctable errors — an unmatched entry
 * with the closest available suggestions, a category word written without its name, a targeted phrase
 * without a target.
 *
 * It also gates each resolved term against that same range's `.legal`/`.available` flags (the exact
 * flags the rendered menu filters on), so an off-menu term (e.g. a Declaration of Friendship with an
 * un-met civ) is rejected here, up front, rather than slipping through to `appendDealProposal` where
 * the game reports it untradeable — often with the reason misattributed to a different item in the
 * same deal. `appendDealProposal` still re-inspects and hard-gates as the backstop; when the upfront
 * range is unavailable (inspection failed) this module degrades to pass-through for fixed labels.
 */

import type {
  CandidateLegality,
  NormalizedSideRange,
  PromiseTargetInfo,
} from "../../../../mcp-server/dist/tools/knowledge/inspect-deal.js";
import { AGREEMENT_METADATA, TARGETED_PROMISE_TYPES } from "../../../../mcp-server/dist/utils/deal-schema.js";
import type {
  AuthoredTradeItem,
  PromiseTerm,
  TradeItem,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
import { closestNames, findByName, namesOf } from "../../utils/text-match.js";
import { parseEntry, targetExample, type LedgerTermLabel } from "./ledger-grammar.js";

// The vocabulary lives in the grammar module; re-exported so callers and the drift-guard tests keep a
// single import site for the ledger's term surface.
export { LEDGER_TERMS, type LedgerTermLabel } from "./ledger-grammar.js";

/** A single ledger entry that could not be resolved, rendered back to the model as corrective feedback. */
export interface LedgerResolutionError {
  Side: "Give" | "Receive";
  /** The raw authored string, quoted back verbatim so the model sees exactly what it wrote. */
  Entry: string;
  Problem: string;
  /** Closest available terms/names for that side (when the miss was a lookup). */
  Suggestions?: string[];
}

/** The resolved ledger: directed trade items + promises, plus any per-entry resolution errors. */
export interface ResolvedLedger {
  items: AuthoredTradeItem[];
  promises: PromiseTerm[];
  errors: LedgerResolutionError[];
}

/** What a friendly term label maps to in the canonical deal contract. */
type ResolvedKind =
  | { kind: "item"; itemType: TradeItem["itemType"] }
  | { kind: "promise"; promiseType: PromiseTerm["promiseType"] };

/** Friendly label → canonical item/promise type. */
const TERM_MAP: Record<LedgerTermLabel, ResolvedKind> = {
  Gold: { kind: "item", itemType: "GOLD" },
  "Gold Per Turn": { kind: "item", itemType: "GOLD_PER_TURN" },
  Resource: { kind: "item", itemType: "RESOURCES" },
  City: { kind: "item", itemType: "CITIES" },
  Technology: { kind: "item", itemType: "TECHS" },
  "Allow Embassy": { kind: "item", itemType: "ALLOW_EMBASSY" },
  "Open Borders": { kind: "item", itemType: "OPEN_BORDERS" },
  Maps: { kind: "item", itemType: "MAPS" },
  "Declaration of Friendship": { kind: "item", itemType: "DECLARATION_OF_FRIENDSHIP" },
  "Defensive Pact": { kind: "item", itemType: "DEFENSIVE_PACT" },
  "Research Agreement": { kind: "item", itemType: "RESEARCH_AGREEMENT" },
  "Peace Treaty": { kind: "item", itemType: "PEACE_TREATY" },
  Vassalage: { kind: "item", itemType: "VASSALAGE" },
  "Revoke Vassalage": { kind: "item", itemType: "VASSALAGE_REVOKE" },
  "Third-Party Peace": { kind: "item", itemType: "THIRD_PARTY_PEACE" },
  "Third-Party War": { kind: "item", itemType: "THIRD_PARTY_WAR" },
  "Vote Commitment": { kind: "item", itemType: "VOTE_COMMITMENT" },
  "Won't attack / will move troops away": { kind: "promise", promiseType: "MILITARY" },
  "Won't settle near you": { kind: "promise", promiseType: "EXPANSION" },
  "Won't buy plots near your cities": { kind: "promise", promiseType: "BORDER" },
  "Won't dig your antiquity sites": { kind: "promise", promiseType: "NO_DIGGING" },
  // Omitted to match LEDGER_TERMS — the tactical AI doesn't honor these (see note there):
  // "Won't spread my religion to you": { kind: "promise", promiseType: "NO_CONVERT" },
  // "Won't spy on you": { kind: "promise", promiseType: "SPY" },
  // "Won't bully your protected city-state": { kind: "promise", promiseType: "BULLY_CITY_STATE" },
  // "Won't attack your protected city-state": { kind: "promise", promiseType: "ATTACK_CITY_STATE" },
  "Will join a cooperative war": { kind: "promise", promiseType: "COOP_WAR" },
};

/**
 * Toggle/agreement itemType → its `CandidateLegality` slot on a {@link NormalizedSideRange}. Built from
 * the single source of truth (`AGREEMENT_METADATA`) so the resolver's legality gate keys off the exact
 * same field the rendered menu (`formatSideMenu`) filters on. Named items (resources/cities/techs/
 * third-party/votes) are NOT here — those are gated inside {@link lookupByName} against their own `.legal`.
 */
const RANGE_KEY_BY_ITEM_TYPE = new Map<TradeItem["itemType"], string>(
  AGREEMENT_METADATA.map((a) => [a.itemType, a.rangeKey])
);

/**
 * The reason an authored toggle/gold term is NOT available to author against the given side range, or
 * `undefined` when it is available (or cannot be judged). This is the author-time mirror of the menu's
 * `.legal`/`.available` filter:
 *  - an ABSENT range means the upfront inspection failed (no menu was shown), so there is no ground truth
 *    to enforce — return `undefined` and let `appendDealProposal`'s own inspection be the backstop;
 *  - gold/gold-per-turn gate on `range.gold.available` / `range.goldPerTurn.available`;
 *  - a toggle whose candidate is present-and-illegal — or absent entirely (a ruleset-hidden research
 *    agreement / vassalage the side can never offer) — is rejected, carrying the candidate's own reason
 *    line when the game gave one.
 */
function availabilityProblem(
  range: NormalizedSideRange | undefined,
  itemType: TradeItem["itemType"],
  sideLower: string
): string | undefined {
  if (!range) return undefined;
  const generic = `not available to ${sideLower} under the current game state`;
  if (itemType === "GOLD" || itemType === "GOLD_PER_TURN") {
    const slot = itemType === "GOLD" ? range.gold : range.goldPerTurn;
    if (slot.available) return undefined;
    return slot.reasons.length > 0 ? slot.reasons.join("; ") : generic;
  }
  const rangeKey = RANGE_KEY_BY_ITEM_TYPE.get(itemType);
  if (!rangeKey) return undefined; // named items are gated in lookupByName instead
  const cand = range[rangeKey as keyof NormalizedSideRange] as CandidateLegality | undefined;
  if (cand?.legal) return undefined;
  return cand?.reasons && cand.reasons.length > 0 ? cand.reasons.join("; ") : generic;
}

/** A named candidate row from a side range (resources/cities/techs/third-party/votes). Carries the
 *  candidate's own structural legality so an off-menu (illegal) named term is rejected like a toggle. */
interface NamedCandidate {
  name?: string;
  legal?: boolean;
  reasons?: string[];
}

/**
 * Resolve a named candidate against one category of a side's range, with uniform feedback: an empty
 * category, or an unknown name (with the closest available suggestions), or an off-menu name flagged
 * untradeable. Returns the matched candidate, or a `problem` (+ suggestions) for the caller to record.
 *
 * For resources/cities/techs/votes the grammar's `matchNamed` has already proven the name resolves, so
 * only the `legal === false` gate below is reachable; for third-party peace/war the target arrives
 * unvalidated from the phrase regex, so the empty/not-found branches are load-bearing.
 */
function lookupByName<T extends NamedCandidate>(
  list: readonly T[],
  name: string | undefined,
  labels: { noun: string; nounPlural: string },
  sideLower: string
): { match: T } | { problem: string; suggestions?: string[] } {
  if (!name) return { problem: `name the ${labels.noun} from the menu.` };
  if (list.length === 0) return { problem: `there are no ${labels.nounPlural} available to ${sideLower}.` };
  const match = findByName(list, name);
  if (!match) {
    return {
      problem: `no ${labels.noun} named "${name}" is available to ${sideLower}.`,
      suggestions: closestNames(namesOf(list), name),
    };
  }
  // On the menu by name but flagged untradeable in the current game state (the menu shows only legal
  // named candidates, so this catches an off-menu one the model named anyway). `legal` is undefined only
  // for bare-name test lists — real inspect-deal candidates always carry it — so this never over-rejects.
  if (match.legal === false) {
    return {
      problem: `${labels.noun} "${name}" is not available to ${sideLower}: ${(match.reasons ?? []).join("; ") || "not tradeable under current game state"}`,
    };
  }
  return { match };
}

/** Render resolution errors back to the model as a single corrective block (no deal was written). */
export function formatResolutionErrors(errors: LedgerResolutionError[]): string {
  const lines = errors.map((e) => {
    const head = `- [${e.Side}] "${e.Entry}": ${e.Problem}`;
    return e.Suggestions && e.Suggestions.length > 0
      ? `${head} Did you mean: ${e.Suggestions.join(", ")}?`
      : head;
  });
  return ["Could not author the deal. Fix these entries and call propose-deal again:", ...lines].join("\n");
}

/**
 * Resolve a Give/Receive ledger of plain strings into directed trade items + promises with IDs. `Give`
 * entries run agent→counterpart and resolve against the agent's own range; `Receive` entries run
 * counterpart→agent and resolve against the counterpart's range. Each string is parsed by
 * {@link parseEntry}; misses become {@link LedgerResolutionError}s with suggestions instead of silently
 * dropped terms. Each resolved term is also gated against that side range's `.legal`/`.available` flags
 * (the same ones the menu filters on), so an off-menu term becomes a correctable error here rather than
 * an untradeable-item failure at storage; an absent range (inspection failed) skips the gate and relies
 * on `appendDealProposal`'s re-inspection as the backstop.
 */
export function resolveLedger(args: {
  give: string[];
  receive: string[];
  agentID: number;
  counterpartID: number;
  giveRange: NormalizedSideRange | undefined;
  receiveRange: NormalizedSideRange | undefined;
  promiseTargets: PromiseTargetInfo[];
}): ResolvedLedger {
  const { give, receive, agentID, counterpartID, giveRange, receiveRange, promiseTargets } = args;
  const items: AuthoredTradeItem[] = [];
  const promises: PromiseTerm[] = [];
  const errors: LedgerResolutionError[] = [];
  // The DLL allows only one vote commitment per giver per deal; track which sides already used theirs.
  const voteCommittedBy = new Set<number>();

  const resolveSide = (
    side: "Give" | "Receive",
    terms: string[],
    giverID: number,
    receiverID: number,
    range: NormalizedSideRange | undefined
  ): void => {
    for (const raw of terms) {
      const fail = (problem: string, suggestions?: string[]): void => {
        errors.push({ Side: side, Entry: raw, Problem: problem, Suggestions: suggestions });
      };

      const parsedEntry = parseEntry(raw, range, promiseTargets);
      if ("problem" in parsedEntry) {
        fail(parsedEntry.problem, parsedEntry.suggestions);
        continue;
      }
      const { term, name, amount } = parsedEntry.parsed;
      // parseEntry only ever yields a valid LedgerTermLabel, so the mapping is always present.
      const mapped = TERM_MAP[term];

      if (mapped.kind === "promise") {
        const promiseType = mapped.promiseType;
        const promise: PromiseTerm = { promiserID: giverID, recipientID: receiverID, promiseType };
        if (TARGETED_PROMISE_TYPES.has(promiseType)) {
          if (!name) {
            fail(`name the ally civilization, e.g. "${targetExample(term)}".`);
            continue;
          }
          // Coop War targets a major the giver can validly go to war alongside.
          const eligible = promiseTargets.filter((pt) => pt.kind === "major" && pt.coopWarEligible !== false);
          const match = findByName(eligible, name);
          if (!match) {
            fail(
              `no eligible target named "${name}" for this promise.`,
              closestNames(eligible.map((e) => e.name ?? `player ${e.playerID}`), name)
            );
            continue;
          }
          promise.targetPlayerID = match.playerID;
        }
        promises.push(promise);
        continue;
      }

      const itemType = mapped.itemType;
      const base: AuthoredTradeItem = { fromPlayerID: giverID, toPlayerID: receiverID, itemType };

      switch (itemType) {
        case "GOLD":
        case "GOLD_PER_TURN": {
          if (amount === undefined || amount <= 0) {
            fail(`${term} needs a positive whole amount, e.g. "${term} 100".`);
            continue;
          }
          const problem = availabilityProblem(range, itemType, side.toLowerCase());
          if (problem) {
            fail(problem);
            continue;
          }
          items.push({ ...base, amount });
          break;
        }
        case "RESOURCES": {
          const r = lookupByName(range?.resources ?? [], name, { noun: "resource", nounPlural: "resources" }, side.toLowerCase());
          if (!("match" in r)) {
            fail(r.problem, r.suggestions);
            continue;
          }
          // Quantity defaults to 1; reject non-positive amounts and cap to what the side actually holds.
          const qty = amount ?? 1;
          if (qty <= 0) {
            fail("resource quantity must be a positive whole number.");
            continue;
          }
          items.push({ ...base, resourceID: r.match.resourceID, quantity: Math.min(qty, r.match.quantityAvailable) });
          break;
        }
        case "CITIES": {
          const c = lookupByName(range?.cities ?? [], name, { noun: "city", nounPlural: "cities" }, side.toLowerCase());
          if (!("match" in c)) {
            fail(c.problem, c.suggestions);
            continue;
          }
          items.push({ ...base, cityID: c.match.cityID });
          break;
        }
        case "TECHS": {
          const tech = lookupByName(range?.techs ?? [], name, { noun: "technology", nounPlural: "technologies" }, side.toLowerCase());
          if (!("match" in tech)) {
            fail(tech.problem, tech.suggestions);
            continue;
          }
          items.push({ ...base, techID: tech.match.techID });
          break;
        }
        case "THIRD_PARTY_PEACE":
        case "THIRD_PARTY_WAR": {
          const list = itemType === "THIRD_PARTY_PEACE" ? range?.thirdPartyPeace : range?.thirdPartyWar;
          const tp = lookupByName(list ?? [], name, { noun: "third party", nounPlural: `${term.toLowerCase()} targets` }, side.toLowerCase());
          if (!("match" in tp)) {
            fail(tp.problem, tp.suggestions);
            continue;
          }
          items.push({ ...base, thirdPartyTeamID: tp.match.teamID });
          break;
        }
        case "VOTE_COMMITMENT": {
          const v = lookupByName(range?.voteCommitments ?? [], name, { noun: "vote commitment", nounPlural: "vote commitments" }, side.toLowerCase());
          if (!("match" in v)) {
            fail(v.problem, v.suggestions);
            continue;
          }
          if (voteCommittedBy.has(giverID)) {
            fail("only one vote commitment per side is allowed; you already committed one on this side.");
            continue;
          }
          voteCommittedBy.add(giverID);
          items.push({
            ...base,
            resolutionID: v.match.resolutionID,
            voteChoice: v.match.voteChoice,
            numVotes: v.match.numVotes,
            repeal: v.match.repeal,
          });
          break;
        }
        default: {
          // Single-shot toggles (embassy, open borders, maps, mutual agreements, vassalage): no data.
          // Gate against the authored side's menu legality so the model can't author an off-menu toggle
          // (e.g. a Declaration of Friendship with an un-met civ) that would later fail inspection with a
          // reason misattributed to another item in the deal. An absent range degrades to pass-through.
          const problem = availabilityProblem(range, itemType, side.toLowerCase());
          if (problem) {
            fail(problem);
            continue;
          }
          items.push(base);
          break;
        }
      }
    }
  };

  resolveSide("Give", give, agentID, counterpartID, giveRange);
  resolveSide("Receive", receive, counterpartID, agentID, receiveRange);

  return { items, promises, errors };
}
