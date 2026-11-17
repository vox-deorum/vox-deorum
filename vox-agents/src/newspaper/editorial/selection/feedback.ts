/** Recompute preferences from current votes on unique canonical published items. */
import type { FeedbackRecord, PublicationState } from '../../contracts/publication.js';
import type { EditorialConfig } from '../config/schema.js';

/** Calculate persistent series votes and distinctive tag votes over the configured item window. */
export function computeFeedback(state: PublicationState, config: EditorialConfig): FeedbackRecord {
  const coefficients = config.defaults.feedback;
  const items = [
    ...new Map(
      state.issues.flatMap((issue) => issue.items).map((item) => [item.id, item])
    ).values(),
  ];
  const window = items.slice(-coefficients.window);
  const votes: Record<string, number> = {};
  const seriesAdjustments: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  const tagAdjustments: Record<string, number> = {};
  for (const item of items) {
    const vote = state.votes[item.id] ?? 0;
    votes[item.id] = vote;
    for (const key of new Set(item.seriesKeys))
      seriesAdjustments[key] = (seriesAdjustments[key] ?? 0) + vote * coefficients.series;
  }
  for (const item of window) {
    const tags = [...new Set(item.tags)];
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      tagAdjustments[tag] = (tagAdjustments[tag] ?? 0) + (votes[item.id] ?? 0) / tags.length;
    }
  }
  for (const tag of Object.keys(tagAdjustments))
    tagAdjustments[tag] *=
      (1 + Math.log((window.length + 1) / (tagCounts[tag] + 1))) * coefficients.tag;
  return {
    revision: JSON.stringify(
      Object.entries(votes).sort(([left], [right]) => left.localeCompare(right))
    ),
    windowItemIds: window.map((item) => item.id),
    votes,
    tagCounts,
    seriesAdjustments,
    tagAdjustments,
    coefficients,
  };
}

/** Bound combined feedback while keeping urgent editorial priority independent. */
export function candidateFeedback(
  seriesKeys: string[],
  tags: string[],
  feedback: FeedbackRecord
): number {
  const series = [...new Set(seriesKeys)].reduce(
    (sum, key) => sum + (feedback.seriesAdjustments[key] ?? 0),
    0
  );
  const distinctTags = [...new Set(tags)];
  const tag = distinctTags.length
    ? distinctTags.reduce((sum, key) => sum + (feedback.tagAdjustments[key] ?? 0), 0) /
      distinctTags.length
    : 0;
  return Math.min(
    feedback.coefficients.bound,
    Math.max(-feedback.coefficients.bound, series + tag)
  );
}
