/**
 * Utilities for calculating weighted fields in database searches
 */

import { search } from "fast-fuzzy";

/**
 * Default field weights for database searches
 * Higher values indicate more importance in search relevance
 */
export const defaultFieldWeights: Record<string, number> = {
  Name: 3.0,
  Type: 2.0,
  Help: 1.0,
  Description: 1.0,
  Strategy: 1.0,
  Branch: 1.0,
  Era: 1.0
};

/**
 * Performs weighted fuzzy search across multiple fields
 * @param keyword - Search keyword
 * @param items - Items to search
 * @param fieldWeights - Weight for each field (higher = more important)
 * @param threshold - Minimum weighted score to include (0-1)
 * @returns Ranked array of items that meet the threshold
 */
export function weightedFuzzySearch(
  keyword: string,
  items: Record<string, unknown>[],
  fieldWeights: Record<string, number>,
  threshold: number
): Record<string, unknown>[] {
  // Calculate total weight for normalization
  const totalWeight = Object.values(fieldWeights).reduce((sum, weight) => sum + weight, 0);

  // Score each item
  const scoredItems = items.map(item => {
    let weightedScore = 0;

    // Search each field individually and accumulate weighted scores
    for (const [field, weight] of Object.entries(fieldWeights)) {
      const fieldValue = item[field];
      if (fieldValue) {
        // Search just this field without threshold
        const matches = search(keyword, [fieldValue], {
          threshold: 0,
          returnMatchData: true
        });

        if (matches.length > 0) {
          // fast-fuzzy returns scores where higher is better (0-1 range)
          const fieldScore = matches[0].score;
          weightedScore += fieldScore * weight;
        }
      }
    }

    // Normalize by total weight
    const normalizedScore = weightedScore / totalWeight;

    return {
      item,
      score: normalizedScore
    };
  });

  // Filter by threshold and sort by score descending
  return scoredItems
    .filter(result => result.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map(result => result.item);
}
