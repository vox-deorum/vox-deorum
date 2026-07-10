/**
 * @module utils/text-match
 *
 * Small, domain-free string helpers for forgiving user/model-authored text: punctuation folding,
 * case-insensitive name lookup, edit-distance ranking for "did you mean" suggestions, and peeling a
 * trailing whole number or a leading list bullet off a line. Kept generic (no deal/ledger knowledge)
 * so any parser that matches free-text against a known vocabulary can reuse them.
 */

/**
 * Fold punctuation for forgiving matching WITHOUT lowercasing: map curly apostrophes to straight, the
 * dash family to a plain hyphen, and collapse internal whitespace. Keeps case so an extracted name
 * still reads naturally in echoes and error messages.
 */
export function foldPunct(s: string): string {
  return s
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ");
}

/**
 * Normalize a string for forgiving vocabulary matching: {@link foldPunct} plus case folding. Lets a
 * casing or punctuation slip resolve to its canonical form instead of missing.
 */
export function normalizeForMatch(s: string): string {
  return foldPunct(s).toLowerCase();
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

/** Up to `limit` names ranked closest to `query` (substring matches first, then edit distance). */
export function closestNames(names: string[], query: string, limit = 3): string[] {
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

/** Find an item by punctuation/case-insensitive exact name; first match wins. */
export function findByName<T extends { name?: string }>(list: readonly T[], name: string): T | undefined {
  const q = normalizeForMatch(name);
  return list.find((c) => normalizeForMatch(c.name ?? "") === q);
}

/** Non-empty names from a list, for suggestions. */
export function namesOf(list: readonly { name?: string }[] | undefined): string[] {
  return (list ?? []).map((c) => c.name ?? "").filter((n) => n.length > 0);
}

/** Strip a leading list bullet ("- ", "* ", "• ") and surrounding whitespace. */
export function stripBullet(raw: string): string {
  return raw.replace(/^\s*[-*•]\s+/, "").trim();
}

/** Split one trailing whole number off a string: "Gold 200" → { base: "Gold", amount: 200 }. */
export function splitTrailingAmount(s: string): { base: string; amount?: number } {
  const m = /^(.*\S)\s+(\d+)$/.exec(s);
  if (!m) return { base: s };
  return { base: m[1], amount: Number(m[2]) };
}
