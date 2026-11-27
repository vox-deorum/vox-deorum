/** Deterministic story selection with conflict, variety and priority rules. */
import type { FeedbackRecord, PublicationState } from '../../contracts/publication.js';
import type { EditorialConfig } from '../config/schema.js';
import { candidateFeedback } from './feedback.js';
import type { EditorialCandidate } from './templates.js';

/** Why the editor kept or passed over a candidate. */
export type SelectionOutcome = 'selected' | 'outranked' | 'conflict' | 'printed-before' | 'not-positive' | 'no-variants';

export interface HeuristicSelection {
  selected: EditorialCandidate[];
  scores: { id: string; score: number; selected: boolean }[];
  /** Each candidate's selection outcome, keyed by candidate ID. */
  outcomes: Map<string, SelectionOutcome>;
}

/** Track editions' printed fingerprints and developments already covered by a merge. */
export function publishedFingerprints(state: PublicationState): Set<string> {
  return new Set(state.issues.flatMap(issue =>
    issue.items.flatMap(item => [item.fingerprint, ...(item.coveredFingerprints ?? [])])
  ));
}

/** Score evidence-backed choices, selecting one angle per incident, series or development. */
export function selectHeuristic(
  candidates: EditorialCandidate[],
  state: PublicationState,
  config: EditorialConfig,
  feedback: FeedbackRecord
): HeuristicSelection {
  const usedSeries = new Set<string>();
  const usedTriggers = new Set<string>();
  const usedConflicts = new Set<string>();
  const usedTags = new Set<string>();
  const selected: EditorialCandidate[] = [];
  const scores = new Map<string, number>();
  const published = publishedFingerprints(state);
  const outcomes = new Map<string, SelectionOutcome>();
  const remaining = candidates.filter((candidate) => {
    if (published.has(candidate.fingerprint)) outcomes.set(candidate.id, 'printed-before');
    else if (!candidate.variants.length) outcomes.set(candidate.id, 'no-variants');
    else return true;
    return false;
  });
  /** Check whether a selected story already covers any of this candidate's subjects. */
  const conflicts = (candidate: EditorialCandidate) =>
    candidate.seriesKeys.some((key) => usedSeries.has(key)) ||
    candidate.triggerIds.some((id) => usedTriggers.has(id)) ||
    (candidate.conflictKeys ?? []).some((key) => usedConflicts.has(key));
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
          !conflicts(candidate)
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
    if (conflicts(candidate)) {
      outcomes.set(candidate.id, 'conflict');
      continue;
    }
    if (!candidate.urgent && weight <= 0) {
      outcomes.set(candidate.id, 'not-positive');
      continue;
    }
    outcomes.set(candidate.id, 'selected');
    selected.push(candidate);
    candidate.seriesKeys.forEach((key) => usedSeries.add(key));
    candidate.triggerIds.forEach((id) => usedTriggers.add(id));
    candidate.conflictKeys?.forEach((key) => usedConflicts.add(key));
    candidate.tags.forEach((tag) => usedTags.add(tag));
  }
  for (const candidate of candidates) {
    if (!scores.has(candidate.id)) scores.set(candidate.id, score(candidate));
    if (!outcomes.has(candidate.id)) outcomes.set(candidate.id, 'outranked');
  }
  return {
    selected,
    outcomes,
    scores: candidates.map((candidate) => ({
      id: candidate.id,
      score: scores.get(candidate.id)!,
      selected: selected.includes(candidate),
    })),
  };
}
