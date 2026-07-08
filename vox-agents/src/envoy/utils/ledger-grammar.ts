/**
 * @module envoy/utils/ledger-grammar
 *
 * The forgiving string grammar for the negotiator's Give/Take ledger: it parses one authored PLAIN
 * STRING (a term copied from the rendered menu) into a canonical {@link LedgerTermLabel} plus an
 * optional entity/target name and quantity, or a correctable problem. It knows the vocabulary (labels,
 * aliases, named categories, targeted phrases) but nothing about IDs or legality — {@link resolveLedger}
 * in `./ledger-resolver.ts` turns a {@link ParsedTerm} into a directed, ID-bearing trade item and gates
 * it against the tradable range.
 *
 * A string can be: a fixed label ("Gold", "Open Borders"), an entity NAME (a Resource / City /
 * Technology / Vote resolution), a category-prefixed name ("Resource Iron"), or a targeted phrase
 * ("Third-Party Peace with Rome"). A trailing whole number carries a quantity ("Iron 2"); it is ignored
 * for terms with no quantity. Two small tables single-source the two families that otherwise splinter:
 * {@link NAMED_CATEGORIES} for the name-required categories and {@link TARGETED_TERMS} for the
 * civilization-targeted phrases.
 */

import type {
  NormalizedSideRange,
  PromiseTargetInfo,
} from "../../../../mcp-server/dist/tools/knowledge/inspect-deal.js";
import {
  closestNames,
  findByName,
  foldPunct,
  namesOf,
  normalizeForMatch,
  splitTrailingAmount,
  stripBullet,
} from "../../utils/text-match.js";

/**
 * The friendly term labels the ledger uses, shared verbatim by the rendered GIVE/TAKE menu so the
 * model copies them directly. Trade-item agreement labels and promise labels are the canonical single
 * labels from AGREEMENT_METADATA / PROMISE_METADATA (deal-schema.ts), so the authored term and the
 * rendered menu never splinter.
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
  // deal-schema.ts); a drift guard test asserts it. Kept as a literal tuple for the label maps below.
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
  // deal-schema.ts). A drift guard test asserts they stay in sync. The non-honored promises (Won't
  // spread religion / spy / bully / attack city-state) are absent because they are not in the
  // contract — re-add here (and uncomment them in the metadata) if the DLL ever enforces them.
  "Won't attack / will move troops away",
  "Won't settle near you",
  "Won't buy plots near your cities",
  "Won't dig your antiquity sites",
  "Will join a cooperative war",
] as const;

export type LedgerTermLabel = (typeof LEDGER_TERMS)[number];

/** One parsed Give/Take entry: the resolved canonical label plus an optional entity/target name and amount. */
export interface ParsedTerm {
  term: LedgerTermLabel;
  name?: string;
  amount?: number;
}

/**
 * A name-required category: a bare label ("Resource") is a "write the name" error, but a name or a
 * category-word-prefixed name ("Iron", "Resource Iron") resolves against `select(range)`. One table
 * drives label classification, the category-prefix grammar, the suggestion pool, and the bare-label
 * guide. Order is the ambiguity precedence for a bare name: resources → cities → techs → votes.
 */
interface NamedCategory {
  label: LedgerTermLabel;
  /** The candidate rows for this category on a side range. */
  select: (range: NormalizedSideRange) => readonly { name?: string }[];
  /** Anchored pattern matching just the category word(s) of a prefixed entry ("Resource Iron"). */
  prefix: RegExp;
  /** Noun used in the "no <noun> named ..." guide. */
  noun: string;
  /** A copyable example for the bare-label guide, category-appropriate. */
  example: string;
}

const NAMED_CATEGORIES: readonly NamedCategory[] = [
  { label: "Resource", select: (r) => r.resources ?? [], prefix: /^resources?$/i, noun: "resource", example: "Iron 2" },
  { label: "City", select: (r) => r.cities ?? [], prefix: /^(?:city|cities)$/i, noun: "city", example: "Berlin" },
  { label: "Technology", select: (r) => r.techs ?? [], prefix: /^tech(?:nology|nologies)?$/i, noun: "technology", example: "Banking" },
  { label: "Vote Commitment", select: (r) => r.voteCommitments ?? [], prefix: /^vote commitments?$/i, noun: "vote commitment", example: "Embargo Carthage, Yes" },
];

/** Category labels that name nothing on their own; a bare one is a "write the name" author error. */
const NAME_REQUIRED_LABELS = new Set<LedgerTermLabel>(NAMED_CATEGORIES.map((c) => c.label));

/**
 * A civilization-targeted phrase ("Third-Party Peace with Rome", "cooperative war on Rome"). One table
 * drives the phrase regexes, the label mapping, the bare-label guide example, the target suggestions,
 * and the suggestion-pool phrasing. COOP_WAR is first because its phrasing also contains "war"; the
 * bare-war pattern only starts at "war".
 */
interface TargetedTerm {
  label: LedgerTermLabel;
  /** Matches the phrase and captures the target name in group 1 (run on a folded, case-preserved string). */
  re: RegExp;
  /** A copyable example for the bare-label guide. */
  example: string;
  /** Render a target name back into its copyable phrase, for the suggestion pool. */
  phrase: (name: string) => string;
  /** Available target names for this phrase on the given side, as suggestions. */
  suggestions: (range: NormalizedSideRange | undefined, promiseTargets: PromiseTargetInfo[]) => string[];
}

const coopEligibleNames = (promiseTargets: PromiseTargetInfo[]): string[] =>
  promiseTargets
    .filter((pt) => pt.kind === "major" && pt.coopWarEligible !== false)
    .map((pt) => pt.name ?? "")
    .filter((n) => n.length > 0);

const TARGETED_TERMS: readonly TargetedTerm[] = [
  {
    label: "Will join a cooperative war",
    re: /^(?:will join a )?(?:co-?operative|coop|joint) war (?:on|with|against) (.+)$/i,
    example: "Will join a cooperative war on <Civilization>",
    phrase: (name) => `Will join a cooperative war on ${name}`,
    suggestions: (_range, promiseTargets) => coopEligibleNames(promiseTargets),
  },
  {
    label: "Third-Party Peace",
    re: /^(?:third-party )?peace with (.+)$/i,
    example: "Third-Party Peace with <Civilization>",
    phrase: (name) => `Third-Party Peace with ${name}`,
    suggestions: (range) => namesOf(range?.thirdPartyPeace),
  },
  {
    label: "Third-Party War",
    re: /^(?:third-party )?war (?:on|with|against) (.+)$/i,
    example: "Third-Party War on <Civilization>",
    phrase: (name) => `Third-Party War on ${name}`,
    suggestions: (range) => namesOf(range?.thirdPartyWar),
  },
];

/** Labels that need a third-party civilization; a bare one is a "name the target" author error. */
const TARGET_REQUIRED_LABELS = new Set<LedgerTermLabel>(TARGETED_TERMS.map((t) => t.label));

/** Fixed labels an entry can stand alone as (no entity name, no target) — the suggestion baseline. */
const SIMPLE_LABELS: readonly LedgerTermLabel[] = LEDGER_TERMS.filter(
  (t) => !NAME_REQUIRED_LABELS.has(t) && !TARGET_REQUIRED_LABELS.has(t)
);

/** Normalized-form → canonical label, built once for label matching. */
const TERM_BY_NORMALIZED = new Map<string, LedgerTermLabel>(
  LEDGER_TERMS.map((t) => [normalizeForMatch(t), t])
);

/**
 * Common short-hands the model reaches for, normalized-form → canonical label. Keeps the menu on its
 * canonical labels while still accepting "Friendship"/"Embassy"/"GPT" and the bare "cooperative war"
 * (which then reports the missing target). Targeted phrases with a target ("peace with X") are handled
 * by {@link TARGETED_TERMS}, not here.
 */
const LEDGER_ALIASES = new Map<string, LedgerTermLabel>([
  ["friendship", "Declaration of Friendship"],
  ["dof", "Declaration of Friendship"],
  ["embassy", "Allow Embassy"],
  ["gpt", "Gold Per Turn"],
  ["map", "Maps"],
  ["cooperative war", "Will join a cooperative war"],
  ["coop war", "Will join a cooperative war"],
  ["co-op war", "Will join a cooperative war"],
  ["joint war", "Will join a cooperative war"],
]);

/** Combined category-prefix pattern ("Resource Iron", "City Berlin"), built from {@link NAMED_CATEGORIES}. */
const CATEGORY_PREFIX_RE = new RegExp(
  `^(${NAMED_CATEGORIES.map((c) => c.prefix.source.replace(/^\^|\$$/g, "")).join("|")})\\s+(.+)$`,
  "i"
);

/** A copyable phrase illustrating the target form for a bare targeted label. */
export function targetExample(label: LedgerTermLabel): string {
  return TARGETED_TERMS.find((t) => t.label === label)?.example ?? "";
}

/** Available third-party target names for a bare targeted label, as suggestions. */
function targetSuggestions(
  label: LedgerTermLabel,
  range: NormalizedSideRange | undefined,
  promiseTargets: PromiseTargetInfo[]
): string[] {
  return TARGETED_TERMS.find((t) => t.label === label)?.suggestions(range, promiseTargets) ?? [];
}

/** Every copyable term/name available on one side, for the "no match" suggestion fallback. */
function suggestionPool(
  range: NormalizedSideRange | undefined,
  promiseTargets: PromiseTargetInfo[]
): string[] {
  const pool: string[] = [...SIMPLE_LABELS];
  if (range) {
    for (const c of NAMED_CATEGORIES) pool.push(...namesOf(c.select(range)));
  }
  for (const t of TARGETED_TERMS) {
    for (const name of t.suggestions(range, promiseTargets)) pool.push(t.phrase(name));
  }
  return pool;
}

/** Match a targeted phrase and extract its label + third-party target name, or `undefined`. */
function matchTargetedPattern(folded: string): { term: LedgerTermLabel; target: string } | undefined {
  for (const t of TARGETED_TERMS) {
    const m = t.re.exec(folded);
    if (m) return { term: t.label, target: m[1].trim() };
  }
  return undefined;
}

/** Match a bare entity NAME against the side range in category precedence order. */
function matchNamed(
  base: string,
  range: NormalizedSideRange | undefined
): { term: LedgerTermLabel; name: string } | undefined {
  if (!range) return undefined;
  for (const c of NAMED_CATEGORIES) {
    if (findByName(c.select(range), base)) return { term: c.label, name: base };
  }
  return undefined;
}

/**
 * Match a category-word-prefixed name ("Resource Iron"). Returns a `match` when the name resolves, a
 * `miss` (carrying the category + remainder) when the prefix is recognized but its name does not — so
 * the caller can guide with that category's own suggestions instead of the whole-string fallback — or
 * `undefined` when there is no category prefix at all.
 */
function matchCategoryPrefixed(
  base: string,
  range: NormalizedSideRange | undefined
):
  | { kind: "match"; term: LedgerTermLabel; name: string }
  | { kind: "miss"; category: NamedCategory; remainder: string }
  | undefined {
  if (!range) return undefined;
  const m = CATEGORY_PREFIX_RE.exec(foldPunct(base));
  if (!m) return undefined;
  const category = NAMED_CATEGORIES.find((c) => c.prefix.test(m[1]));
  if (!category) return undefined;
  const remainder = m[2].trim();
  return findByName(category.select(range), remainder)
    ? { kind: "match", term: category.label, name: remainder }
    : { kind: "miss", category, remainder };
}

/** The outcome of classifying one (base, amount) attempt against the side range. */
type ClassifyResult =
  | { kind: "match"; parsed: ParsedTerm }
  | { kind: "guide"; problem: string; suggestions?: string[] }
  | { kind: "miss" };

/**
 * Classify one cleaned attempt (a base string plus an optional trailing amount) into a canonical term,
 * in precedence order: fixed labels/aliases, then targeted phrases, then entity names, then
 * category-word-prefixed names. A bare category/target word, or a category prefix with an unknown name,
 * returns a `guide` error telling the model what to fix; anything unrecognized is a `miss` so the
 * caller can try the next attempt.
 */
function classify(
  base: string,
  amount: number | undefined,
  range: NormalizedSideRange | undefined,
  promiseTargets: PromiseTargetInfo[]
): ClassifyResult {
  const norm = normalizeForMatch(base);
  const label = TERM_BY_NORMALIZED.get(norm) ?? LEDGER_ALIASES.get(norm);
  if (label) {
    const namedCategory = NAMED_CATEGORIES.find((c) => c.label === label);
    if (namedCategory) {
      return { kind: "guide", problem: `name the specific item from the menu, e.g. "${namedCategory.example}", instead of the category word "${label}".` };
    }
    if (TARGET_REQUIRED_LABELS.has(label)) {
      return { kind: "guide", problem: `${label} needs a target civilization, e.g. "${targetExample(label)}".`, suggestions: targetSuggestions(label, range, promiseTargets) };
    }
    return { kind: "match", parsed: { term: label, amount } };
  }

  const tp = matchTargetedPattern(foldPunct(base));
  if (tp) return { kind: "match", parsed: { term: tp.term, name: tp.target, amount } };

  const named = matchNamed(base, range);
  if (named) return { kind: "match", parsed: { term: named.term, name: named.name, amount } };

  const prefixed = matchCategoryPrefixed(base, range);
  if (prefixed?.kind === "match") return { kind: "match", parsed: { term: prefixed.term, name: prefixed.name, amount } };
  if (prefixed?.kind === "miss") {
    return {
      kind: "guide",
      problem: `no ${prefixed.category.noun} named "${prefixed.remainder}" is on the menu.`,
      suggestions: closestNames(namesOf(prefixed.category.select(range!)), prefixed.remainder),
    };
  }

  return { kind: "miss" };
}

/**
 * Parse one authored Give/Take string into a {@link ParsedTerm}, or a correctable problem. Tries the
 * full string first (so an entity name that ends in a digit or carries parentheses is protected),
 * then the same string minus a trailing parenthetical menu note, then with a trailing whole number
 * peeled off as the amount. The first attempt that classifies wins; a `guide` from any attempt is held
 * and returned only if no attempt matches.
 */
export function parseEntry(
  raw: string,
  range: NormalizedSideRange | undefined,
  promiseTargets: PromiseTargetInfo[]
): { parsed: ParsedTerm } | { problem: string; suggestions?: string[] } {
  const cleaned = stripBullet(raw);
  if (!cleaned) return { problem: "empty entry; write one term per string, following the menu examples." };

  const parenStripped = cleaned.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const attempts: { base: string; amount?: number }[] = [{ base: cleaned }];
  if (parenStripped && parenStripped !== cleaned) attempts.push({ base: parenStripped });
  const split = splitTrailingAmount(parenStripped || cleaned);
  if (split.amount !== undefined) attempts.push({ base: split.base, amount: split.amount });

  let guide: { problem: string; suggestions?: string[] } | undefined;
  for (const attempt of attempts) {
    const result = classify(attempt.base, attempt.amount, range, promiseTargets);
    if (result.kind === "match") return { parsed: result.parsed };
    if (result.kind === "guide") guide ??= { problem: result.problem, suggestions: result.suggestions };
  }
  if (guide) return guide;
  return {
    problem: "no tradable term matches this entry.",
    suggestions: closestNames(suggestionPool(range, promiseTargets), cleaned, 3),
  };
}
