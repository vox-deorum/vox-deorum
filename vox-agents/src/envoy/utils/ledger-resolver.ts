/**
 * @module envoy/utils/ledger-resolver
 *
 * Turns the negotiator's first-person Give/Take ledger (friendly term labels + entity NAMES) into the
 * directed, ID-bearing {@link AuthoredTradeItem}/{@link PromiseTerm} arrays the deal store consumes.
 *
 * The negotiator authors deals by NAME (a Civilization / City / Resource / Technology / Vote name copied
 * from the rendered menu) and by side (`Give` = its own civ gives the counterpart; `Take` = the
 * counterpart gives its civ). This module resolves each name against the upfront `inspect-deal` tradable
 * range (the same menu it was shown) and reports precise, correctable errors — unknown/misspelled names
 * with the closest available suggestions, or whole categories that are empty on that side — so a failed
 * proposal can be fixed without ever exposing numeric IDs to the model. It also gates each authored term
 * against that same range's `.legal`/`.available` flags (the exact flags the rendered menu filters on),
 * so the model can only author terms that were actually on its menu; an off-menu term (e.g. a Declaration
 * of Friendship with an un-met civ) is rejected here, up front, instead of slipping through to
 * `appendDealProposal` where the game reports it untradeable — often with the reason misattributed to a
 * different item in the same deal. `appendDealProposal` still re-inspects and hard-gates as the backstop;
 * when the upfront range is unavailable (inspection failed) this module degrades to pass-through.
 */

import { z } from "zod";
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

/**
 * The friendly term labels the ledger uses, shared verbatim by the rendered GIVE/TAKE menu and the
 * tool schema so the model copies them directly. Trade-item agreement labels and promise labels are
 * the canonical single labels from AGREEMENT_METADATA / PROMISE_METADATA (deal-schema.ts), so the
 * authored term and the rendered menu never splinter.
 */
export const LEDGER_TERMS = [
  "Gold",
  "Gold Per Turn",
  "Resource",
  "City",
  "Technology",
  "Allow Embassy",
  "Open Borders",
  "Maps",
  // Agreement labels MUST mirror AGREEMENT_METADATA[*].label (canonical source of truth in
  // deal-schema.ts); a drift guard test asserts it. Kept as a literal tuple because `z.enum` needs one.
  "Declaration of Friendship",
  "Defensive Pact",
  "Research Agreement",
  "Peace Treaty",
  "Vassalage",
  "Revoke Vassalage",
  "Third-Party Peace",
  "Third-Party War",
  "Vote Commitment",
  // Promise labels below MUST mirror PROMISE_METADATA[*].label (the canonical source of truth in
  // deal-schema.ts). A drift guard test asserts they stay in sync; this list stays a literal tuple
  // because `z.enum(LEDGER_TERMS)` requires one. The non-honored promises (Won't spread religion /
  // spy / bully / attack city-state) are absent because they are not in the contract — re-add here
  // (and uncomment them in the metadata) if the DLL ever enforces them.
  "Won't attack / will move troops away",
  "Won't settle near you",
  "Won't buy plots near your cities",
  "Won't dig your antiquity sites",
  "Will join a cooperative war",
] as const;

export type LedgerTermLabel = (typeof LEDGER_TERMS)[number];

/**
 * Normalize a term for forgiving matching: fold case, map curly apostrophes to straight, the dash
 * family to a plain hyphen, and collapse internal whitespace. Lets a casing/punctuation slip
 * ("won't attack", a curly apostrophe, an en-dash in "Third-Party") resolve to its canonical label
 * instead of tripping enum validation and forcing a retry.
 */
function normalizeTerm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ");
}

/** Normalized-form → canonical label, built once for the preprocess step below. */
const TERM_BY_NORMALIZED = new Map<string, LedgerTermLabel>(
  LEDGER_TERMS.map((t) => [normalizeTerm(t), t])
);

/** Resolve a friendly term label to its canonical spelling, allowing harmless punctuation slips. */
function canonicalLedgerTerm(term: string): LedgerTermLabel | undefined {
  return TERM_BY_NORMALIZED.get(normalizeTerm(term));
}

/** One authored ledger entry, used in both `Give` and `Take`. */
export const LedgerTermSchema = z.object({
  // Forgive minor casing/punctuation differences by mapping to the canonical label before the enum
  // validates; an unrecognized term still falls through to the standard enum error.
  Term: z.preprocess(
    (v) => (typeof v === "string" ? canonicalLedgerTerm(v) ?? v : v),
    z.enum(LEDGER_TERMS).describe("The kind of term, exactly as labelled in the GIVE/TAKE menu.")
  ),
  Name: z
    .string()
    .optional()
    .describe(
      "Exact name from the menu: a Civilization Name (Third-Party Peace/War, Cooperative War, " +
        "city-state promises), City Name, Resource Name, Technology Name, or Vote Commitment name. " +
        "Copy it verbatim; never a number."
    ),
  Amount: z
    .number()
    .int()
    .optional()
    .describe(
      "The quantity for this term: Gold amount, Gold-per-turn amount, or Resource quantity per turn " +
        "(defaults to 1 for resources). Ignored for other terms."
    ),
});
export type LedgerTerm = z.infer<typeof LedgerTermSchema>;

/** A single ledger term that could not be resolved, rendered back to the model as corrective feedback. */
export interface LedgerResolutionError {
  Side: "Give" | "Take";
  Term: string;
  Name?: string;
  Problem: string;
  /** Closest available names from the relevant menu category (when the miss was a name lookup). */
  Suggestions?: string[];
}

/** The resolved ledger: directed trade items + promises, plus any per-term resolution errors. */
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
  // Omitted to match LEDGER_TERMS — the tactical AI doesn't honor these (see note above):
  // "Won't spread my religion to you": { kind: "promise", promiseType: "NO_CONVERT" },
  // "Won't spy on you": { kind: "promise", promiseType: "SPY" },
  // "Won't bully your protected city-state": { kind: "promise", promiseType: "BULLY_CITY_STATE" },
  // "Won't attack your protected city-state": { kind: "promise", promiseType: "ATTACK_CITY_STATE" },
  "Will join a cooperative war": { kind: "promise", promiseType: "COOP_WAR" },
};

/**
 * Toggle/agreement itemType → its `CandidateLegality` slot on a {@link NormalizedSideRange}. Built from
 * the single source of truth (`AGREEMENT_METADATA`) so the resolver's legality gate keys off the exact
 * same field the rendered menu ({@link formatSideMenu}) filters on. Named items (resources/cities/techs/
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

/** Levenshtein distance between two strings (small inputs; iterative DP). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Up to `limit` available names ranked closest to `query` (substring matches first, then distance). */
function closestNames(names: string[], query: string, limit = 3): string[] {
  const q = query.toLowerCase();
  return names
    .map((name) => {
      const lower = name.toLowerCase();
      const contains = lower.includes(q) || q.includes(lower);
      return { name, score: levenshtein(lower, q) - (contains ? 100 : 0) };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((r) => r.name);
}

/** A named candidate row from a side range (resources/cities/techs/third-party/votes). Carries the
 *  candidate's own structural legality so an off-menu (illegal) named term is rejected like a toggle. */
interface NamedCandidate {
  name?: string;
  legal?: boolean;
  reasons?: string[];
}

/** Find a candidate by case-insensitive exact name; first match wins. */
function findByName<T extends NamedCandidate>(list: readonly T[], name: string): T | undefined {
  const q = name.toLowerCase();
  return list.find((c) => (c.name ?? "").toLowerCase() === q);
}

/**
 * Resolve a named candidate against one category of a side's range, with uniform feedback: a missing
 * name, an empty category, or an unknown name (with the closest available suggestions). Returns the
 * matched candidate, or a `problem` (+ suggestions) for the caller to record as a {@link LedgerResolutionError}.
 */
function lookupByName<T extends NamedCandidate>(
  list: readonly T[],
  name: string | undefined,
  labels: { term: string; noun: string; nounPlural: string },
  sideLower: string
): { match: T } | { problem: string; suggestions?: string[] } {
  if (!name) return { problem: `${labels.term} needs a \`Name\` from the menu.` };
  if (list.length === 0) return { problem: `there are no ${labels.nounPlural} available to ${sideLower}.` };
  const match = findByName(list, name);
  if (!match) {
    return {
      problem: `no ${labels.noun} named "${name}" is available to ${sideLower}.`,
      suggestions: closestNames(
        list.map((c) => c.name ?? "").filter((n) => n.length > 0),
        name
      ),
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

/**
 * Resolve a Give/Take ledger into directed trade items + promises with IDs. `Give` terms run
 * agent→counterpart and resolve names against the agent's own range; `Take` terms run
 * counterpart→agent and resolve against the counterpart's range. Names are matched case-insensitively
 * against the rendered menu; misses become {@link LedgerResolutionError}s with suggestions instead of
 * silently dropped terms. Each resolved term is also gated against that side range's `.legal`/`.available`
 * flags (the same ones the menu filters on), so an off-menu term becomes a correctable error here rather
 * than an untradeable-item failure at storage; an absent range (inspection failed) skips the gate and
 * relies on `appendDealProposal`'s re-inspection as the backstop.
 */
export function resolveLedger(args: {
  give: LedgerTerm[];
  take: LedgerTerm[];
  agentID: number;
  counterpartID: number;
  giveRange: NormalizedSideRange | undefined;
  takeRange: NormalizedSideRange | undefined;
  promiseTargets: PromiseTargetInfo[];
}): ResolvedLedger {
  const { give, take, agentID, counterpartID, giveRange, takeRange, promiseTargets } = args;
  const items: AuthoredTradeItem[] = [];
  const promises: PromiseTerm[] = [];
  const errors: LedgerResolutionError[] = [];
  // The DLL allows only one vote commitment per giver per deal; track which sides already used theirs.
  const voteCommittedBy = new Set<number>();

  const resolveSide = (
    side: "Give" | "Take",
    terms: LedgerTerm[],
    giverID: number,
    receiverID: number,
    range: NormalizedSideRange | undefined
  ): void => {
    for (const t of terms) {
      const rawTerm = t.Term;
      const term = canonicalLedgerTerm(rawTerm) ?? rawTerm;
      const mapped = TERM_MAP[term as LedgerTermLabel] as ResolvedKind | undefined;
      const fail = (problem: string, suggestions?: string[]): void => {
        errors.push({ Side: side, Term: term, Name: t.Name, Problem: problem, Suggestions: suggestions });
      };

      if (!mapped) {
        errors.push({ Side: side, Term: rawTerm, Name: t.Name, Problem: "unknown ledger term." });
        continue;
      }

      if (mapped.kind === "promise") {
        const promiseType = mapped.promiseType;
        const promise: PromiseTerm = { promiserID: giverID, recipientID: receiverID, promiseType };
        if (TARGETED_PROMISE_TYPES.has(promiseType)) {
          if (!t.Name) {
            fail("this promise needs a third-party `Name` from the menu.");
            continue;
          }
          // Coop War targets a major the giver can validly go to war alongside.
          const eligible = promiseTargets.filter(
            (pt) => pt.kind === "major" && pt.coopWarEligible !== false
          );
          const match = findByName(eligible, t.Name);
          if (!match) {
            fail(
              `no eligible target named "${t.Name}" for this promise.`,
              closestNames(eligible.map((e) => e.name ?? `player ${e.playerID}`), t.Name)
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
          if (t.Amount === undefined || t.Amount <= 0) {
            fail(`${term} needs a positive \`Amount\`.`);
            continue;
          }
          const problem = availabilityProblem(range, itemType, side.toLowerCase());
          if (problem) {
            fail(problem);
            continue;
          }
          items.push({ ...base, amount: t.Amount });
          break;
        }
        case "RESOURCES": {
          const r = lookupByName(range?.resources ?? [], t.Name, { term: "Resource", noun: "resource", nounPlural: "resources" }, side.toLowerCase());
          if (!("match" in r)) {
            fail(r.problem, r.suggestions);
            continue;
          }
          // Quantity defaults to 1; reject non-positive amounts and cap to what the side actually holds.
          const qty = t.Amount ?? 1;
          if (qty <= 0) {
            fail("Resource quantity (`Amount`) must be a positive number.");
            continue;
          }
          items.push({ ...base, resourceID: r.match.resourceID, quantity: Math.min(qty, r.match.quantityAvailable) });
          break;
        }
        case "CITIES": {
          const c = lookupByName(range?.cities ?? [], t.Name, { term: "City", noun: "city", nounPlural: "cities" }, side.toLowerCase());
          if (!("match" in c)) {
            fail(c.problem, c.suggestions);
            continue;
          }
          items.push({ ...base, cityID: c.match.cityID });
          break;
        }
        case "TECHS": {
          const tech = lookupByName(range?.techs ?? [], t.Name, { term: "Technology", noun: "technology", nounPlural: "technologies" }, side.toLowerCase());
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
          const tp = lookupByName(list ?? [], t.Name, { term, noun: "third party", nounPlural: `${term.toLowerCase()} targets` }, side.toLowerCase());
          if (!("match" in tp)) {
            fail(tp.problem, tp.suggestions);
            continue;
          }
          items.push({ ...base, thirdPartyTeamID: tp.match.teamID });
          break;
        }
        case "VOTE_COMMITMENT": {
          const v = lookupByName(range?.voteCommitments ?? [], t.Name, { term: "Vote Commitment", noun: "vote commitment", nounPlural: "vote commitments" }, side.toLowerCase());
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
  resolveSide("Take", take, counterpartID, agentID, takeRange);

  return { items, promises, errors };
}

/** Render resolution errors back to the model as a single corrective block (no deal was written). */
export function formatResolutionErrors(errors: LedgerResolutionError[]): string {
  const lines = errors.map((e) => {
    const head = `- [${e.Side}] ${e.Term}${e.Name ? ` "${e.Name}"` : ""}: ${e.Problem}`;
    return e.Suggestions && e.Suggestions.length > 0
      ? `${head} Did you mean: ${e.Suggestions.join(", ")}?`
      : head;
  });
  return ["Could not author the deal. Fix these terms and call propose-deal again:", ...lines].join("\n");
}
