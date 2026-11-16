/** Pure series decay and one-contribution-per-item history updates. */
import type { PublicationState, PublishedItemRecord } from '../contracts/publication.js';

/** Decay each series only for elapsed turns since its own previous evaluation. */
export function decaySeries(series: PublicationState['series'], turn: number, factor: number): PublicationState['series'] {
  return Object.fromEntries(Object.entries(series).map(([key, value]) => [key, { ...value,
    importance: value.importance * factor ** Math.max(0, turn - value.evaluatedTurn), evaluatedTurn: Math.max(turn, value.evaluatedTurn) }]));
}

/** Add a canonical item's importance once to each contributing series. */
export function advanceSeries(series: PublicationState['series'], items: PublishedItemRecord[], turn: number): PublicationState['series'] {
  const result = { ...series };
  for (const item of new Map(items.map(item => [item.id, item])).values()) {
    for (const key of new Set(item.seriesKeys)) result[key] = {
      importance: (result[key]?.importance ?? 0) + item.importance, evaluatedTurn: turn,
      lastPublishedTurn: turn, lastIssueId: item.issueId, lastItemId: item.id,
    };
  }
  return result;
}
