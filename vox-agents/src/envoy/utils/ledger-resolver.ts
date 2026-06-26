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
 * proposal can be fixed without ever exposing numeric IDs to the model. It performs NO legality checks;
 * structural legality stays in `appendDealProposal` (which inspects and gates before storing).
 */

import { z } from "zod";
import type {
  NormalizedSideRange,
  PromiseTargetInfo,
} from "../../../../mcp-server/dist/tools/knowledge/inspect-deal.js";
import type {
  AuthoredTradeItem,
  PromiseTerm,
  TradeItem,
} from "../../../../mcp-server/dist/utils/deal-schema.js";

/**
 * The friendly term labels the ledger uses, shared verbatim by the rendered GIVE/TAKE menu and the
 * tool schema so the model copies them directly. Trade items use Title Case; promises use the short
 * "Won't …" / "Cooperative war" voice that mirrors the menu's promise rows.
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
  "Declaration Of Friendship",
  "Defensive Pact",
  "Research Agreement",
  "Peace Treaty",
  "Vassalage",
  "Revoke Vassalage",
  "Third-Party Peace",
  "Third-Party War",
  "Vote Commitment",
  "Won't Attack",
  "Won't Settle Near",
  "Won't Buy Plots",
  "Won't Convert",
  "Won't Dig",
  "Won't Spy",
  "Won't Bully City-State",
  "Won't Attack City-State",
  "Cooperative War",
] as const;

export type LedgerTermLabel = (typeof LEDGER_TERMS)[number];

/** One authored ledger entry, used in both `Give` and `Take`. */
export const LedgerTermSchema = z.object({
  Term: z.enum(LEDGER_TERMS).describe("The kind of term, exactly as labelled in the GIVE/TAKE menu."),
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
  "Declaration Of Friendship": { kind: "item", itemType: "DECLARATION_OF_FRIENDSHIP" },
  "Defensive Pact": { kind: "item", itemType: "DEFENSIVE_PACT" },
  "Research Agreement": { kind: "item", itemType: "RESEARCH_AGREEMENT" },
  "Peace Treaty": { kind: "item", itemType: "PEACE_TREATY" },
  Vassalage: { kind: "item", itemType: "VASSALAGE" },
  "Revoke Vassalage": { kind: "item", itemType: "VASSALAGE_REVOKE" },
  "Third-Party Peace": { kind: "item", itemType: "THIRD_PARTY_PEACE" },
  "Third-Party War": { kind: "item", itemType: "THIRD_PARTY_WAR" },
  "Vote Commitment": { kind: "item", itemType: "VOTE_COMMITMENT" },
  "Won't Attack": { kind: "promise", promiseType: "MILITARY" },
  "Won't Settle Near": { kind: "promise", promiseType: "EXPANSION" },
  "Won't Buy Plots": { kind: "promise", promiseType: "BORDER" },
  "Won't Convert": { kind: "promise", promiseType: "NO_CONVERT" },
  "Won't Dig": { kind: "promise", promiseType: "NO_DIGGING" },
  "Won't Spy": { kind: "promise", promiseType: "SPY" },
  "Won't Bully City-State": { kind: "promise", promiseType: "BULLY_CITY_STATE" },
  "Won't Attack City-State": { kind: "promise", promiseType: "ATTACK_CITY_STATE" },
  "Cooperative War": { kind: "promise", promiseType: "COOP_WAR" },
};

/** Promise types that require a third-party `name` resolved against the promise targets. */
const TARGETED_PROMISES = new Set<PromiseTerm["promiseType"]>([
  "COOP_WAR",
  "BULLY_CITY_STATE",
  "ATTACK_CITY_STATE",
]);

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

/** A named candidate row from a side range (resources/cities/techs/third-party/votes). */
interface NamedCandidate {
  name?: string;
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
  return { match };
}

/**
 * Resolve a Give/Take ledger into directed trade items + promises with IDs. `Give` terms run
 * agent→counterpart and resolve names against the agent's own range; `Take` terms run
 * counterpart→agent and resolve against the counterpart's range. Names are matched case-insensitively
 * against the rendered menu; misses become {@link LedgerResolutionError}s with suggestions instead of
 * silently dropped terms. No legality is checked here — that happens at storage time.
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
      const mapped = TERM_MAP[t.Term as LedgerTermLabel];
      const fail = (problem: string, suggestions?: string[]): void => {
        errors.push({ Side: side, Term: t.Term, Name: t.Name, Problem: problem, Suggestions: suggestions });
      };

      if (mapped.kind === "promise") {
        const promiseType = mapped.promiseType;
        const promise: PromiseTerm = { promiserID: giverID, recipientID: receiverID, promiseType };
        if (TARGETED_PROMISES.has(promiseType)) {
          if (!t.Name) {
            fail("this promise needs a third-party `Name` from the menu.");
            continue;
          }
          const eligible = promiseTargets.filter((pt) =>
            promiseType === "COOP_WAR"
              ? pt.kind === "major" && pt.coopWarEligible !== false
              : pt.kind === "minor" && !!pt.protectingPlayerIDs?.includes(receiverID)
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
            fail(`${t.Term} needs a positive \`Amount\`.`);
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
          const tp = lookupByName(list ?? [], t.Name, { term: t.Term, noun: "third party", nounPlural: `${t.Term.toLowerCase()} targets` }, side.toLowerCase());
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
        default:
          // Single-shot toggles (embassy, open borders, maps, mutual agreements, vassalage): no data.
          items.push(base);
          break;
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
