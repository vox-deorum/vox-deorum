/** Deterministic story selection with conflict, variety and priority rules. */
import type { FeedbackRecord, PublicationState } from '../../contracts/publication.js';
import type { EditorialConfig } from '../config/schema.js';
import { candidateFeedback } from './feedback.js';
import type { EditorialCandidate } from './templates.js';

export interface HeuristicSelection {
  selected: EditorialCandidate[];
  scores: { id: string; score: number; selected: boolean }[];
}

/** Score evidence-backed choices, reserving shared series for their strongest supported angle. */
export function selectHeuristic(
  candidates: EditorialCandidate[],
  state: PublicationState,
  config: EditorialConfig,
  feedback: FeedbackRecord
): HeuristicSelection {
  const usedSeries = new Set<string>();
  const usedTriggers = new Set<string>();
  const usedTags = new Set<string>();
  const selected: EditorialCandidate[] = [];
  const scores = new Map<string, number>();
  const published = new Set(
    state.issues.flatMap((issue) => issue.items.map((item) => item.fingerprint))
  );
  const remaining = candidates.filter(
    (candidate) => candidate.variants.length && !published.has(candidate.fingerprint)
  );
  /** Resolve current variety without mutating persistent history. */
  const score = (candidate: EditorialCandidate): number => {
    const memory = Math.max(
      0,
      ...candidate.seriesKeys.map((key) => state.series[key]?.importance ?? 0)
    );
    const fresh = candidate.seriesKeys.every((key) => !state.series[key]);
    const variety = candidate.tags.some((tag) => !usedTags.has(tag));
    return (
      candidate.importance +
      memory * config.defaults.seriesWeight +
      candidate.weight +
      (fresh ? config.defaults.noveltyBonus : 0) +
      (variety ? config.defaults.varietyBonus : 0) +
      candidateFeedback(candidate.seriesKeys, candidate.tags, feedback)
    );
  };
  while (remaining.length && selected.length < config.defaults.maxItems) {
    const reserveShort =
      config.defaults.maxItems > 1 &&
      selected.length === config.defaults.maxItems - 1 &&
      !selected.some((candidate) => candidate.short) &&
      remaining.some(
        (candidate) =>
          candidate.short &&
          score(candidate) > 0 &&
          !candidate.seriesKeys.some((key) => usedSeries.has(key)) &&
          !candidate.triggerIds.some((id) => usedTriggers.has(id))
      );
    remaining.sort(
      (left, right) =>
        Number(right.urgent) - Number(left.urgent) ||
        (reserveShort ? Number(right.short) - Number(left.short) : 0) ||
        score(right) - score(left) ||
        left.id.localeCompare(right.id)
    );
    const candidate = remaining.shift()!;
    const weight = score(candidate);
    scores.set(candidate.id, weight);
    if (
      (!candidate.urgent && weight <= 0) ||
      candidate.seriesKeys.some((key) => usedSeries.has(key)) ||
      candidate.triggerIds.some((id) => usedTriggers.has(id))
    )
      continue;
    selected.push(candidate);
    candidate.seriesKeys.forEach((key) => usedSeries.add(key));
    candidate.triggerIds.forEach((id) => usedTriggers.add(id));
    candidate.tags.forEach((tag) => usedTags.add(tag));
  }
  for (const candidate of candidates)
    if (!scores.has(candidate.id)) scores.set(candidate.id, score(candidate));
  return {
    selected,
    scores: candidates.map((candidate) => ({
      id: candidate.id,
      score: scores.get(candidate.id)!,
      selected: selected.includes(candidate),
    })),
  };
}
