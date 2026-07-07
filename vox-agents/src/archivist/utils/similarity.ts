/**
 * @module archivist/utils/similarity
 *
 * Composite similarity scoring for episode vectors and MMR diversity selection.
 * Two pathways: in-house TypeScript for batch/pre-selection (selector.ts),
 * and DuckDB SQL expression builders for runtime retrieval (reader.ts).
 */

import type { SimilarityWeights } from '../types.js';
import { retrievalWeights, retrievalNoEmbeddingWeights } from '../types.js';

// ---------------------------------------------------------------------------
// Vector similarity
// ---------------------------------------------------------------------------

/** Vectorized input for similarity computation */
export interface VectorBundle {
  gameStateVector: number[];
  neighborVector: number[];
  embedding?: number[] | null;
}

/** Resolve default weights based on whether embeddings are available */
function defaultWeights(hasEmbedding: boolean): SimilarityWeights {
  return hasEmbedding ? retrievalWeights : retrievalNoEmbeddingWeights;
}

/** Compute cosine similarity between two equal-length vectors. Returns 0 for zero-magnitude vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Compute weighted composite similarity across game state, neighbor, and optional embedding vectors.
 * Defaults weights based on whether both bundles have embeddings.
 */
export function compositeSimilarity(
  a: VectorBundle,
  b: VectorBundle,
  weights: SimilarityWeights = defaultWeights(!!(a.embedding && b.embedding))
): number {
  let score = weights.gameState * cosineSimilarity(a.gameStateVector, b.gameStateVector)
    + weights.neighbor * cosineSimilarity(a.neighborVector, b.neighborVector);

  if (weights.embedding > 0 && a.embedding && b.embedding) {
    score += weights.embedding * cosineSimilarity(a.embedding, b.embedding);
  }

  return score;
}

// ---------------------------------------------------------------------------
// SQL expression builders
// ---------------------------------------------------------------------------

/**
 * Build a SQL expression for composite similarity scoring against query parameters.
 * Uses DuckDB's list_cosine_similarity() for vector operations.
 * Parameters are referenced as $query_gs, $query_nb, $query_emb.
 * Defaults weights based on hasEmbedding.
 */
export function buildSimilaritySql(hasEmbedding: boolean, weights: SimilarityWeights = defaultWeights(hasEmbedding)): string {
  const parts: string[] = [
    `${weights.gameState} * list_cosine_similarity(game_state_vector, $query_gs)`,
    `${weights.neighbor} * list_cosine_similarity(neighbor_vector, $query_nb)`,
  ];

  if (hasEmbedding && weights.embedding > 0) {
    parts.push(
      `${weights.embedding} * COALESCE(list_cosine_similarity(situation_abstract_embedding, $query_emb), 0)`
    );
  }

  return parts.join('\n    + ');
}

// ---------------------------------------------------------------------------
// MMR diversity selection
// ---------------------------------------------------------------------------

/** Candidate row from Stage 1 scoring */
export interface CandidateRow {
  game_id: string;
  turn: number;
  player_id: number;
  civilization: string;
  era: string;
  grand_strategy: string | null;
  is_winner: boolean;
  situation_abstract: string | null;
  decision_abstract: string | null;
  situation: string | null;
  decisions: string | null;
  science_per_pop: number | null;
  culture_per_pop: number | null;
  production_per_pop: number | null;
  gold_per_pop: number | null;
  tourism_share: number | null;
  military_share: number | null;
  population_share: number | null;
  cities_share: number | null;
  minor_allies_share: number | null;
  religion_percentage: number;
  war_weariness: number;
  active_wars: number;
  truces: number;
  domination_progress: number | null;
  science_progress: number | null;
  culture_progress: number | null;
  diplomatic_progress: number | null;
  supply_utilization: number | null;
  game_state_vector: number[];
  neighbor_vector: number[];
  situation_abstract_embedding: number[] | null;
  victory_type: string | null;
  score: number;
}

/** MMR diversity selection on scored candidates. */
export function diversitySelect(
  candidates: CandidateRow[],
  resultLimit: number
): CandidateRow[] {
  if (candidates.length <= resultLimit) return candidates;

  const maxScore = candidates[0].score;
  if (maxScore === 0) return candidates.slice(0, resultLimit);

  // Build vector bundles for pairwise similarity
  const bundles: VectorBundle[] = candidates.map(c => ({
    gameStateVector: c.game_state_vector,
    neighborVector: c.neighbor_vector,
    embedding: c.situation_abstract_embedding,
  }));

  const selected: number[] = [0]; // Start with top-scored candidate
  const remaining = new Set(candidates.map((_, i) => i));
  remaining.delete(0);

  while (selected.length < resultLimit && remaining.size > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;

    for (const idx of remaining) {
      const normalizedScore = candidates[idx].score / maxScore;

      // Max similarity to any already-selected candidate
      let maxSim = -Infinity;
      for (const selIdx of selected) {
        const sim = compositeSimilarity(bundles[idx], bundles[selIdx]);
        if (sim > maxSim) maxSim = sim;
      }

      // Major penalty for same game+player as any selected candidate
      for (const selIdx of selected) {
        if (candidates[idx].game_id === candidates[selIdx].game_id &&
            candidates[idx].player_id === candidates[selIdx].player_id) {
          maxSim = Math.max(maxSim, 1.5);
          break;
        }
      }

      // Gradual win/lose balance penalty
      let winners = 0;
      let losers = 0;
      for (const selIdx of selected) {
        if (candidates[selIdx].is_winner) winners++;
        else losers++;
      }
      const imbalance = candidates[idx].is_winner ? (winners - losers) : (losers - winners);
      if (imbalance > 0) maxSim += imbalance * 0.15;

      const mmr = 0.7 * normalizedScore - 0.3 * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = idx;
      }
    }

    if (bestIdx >= 0) {
      selected.push(bestIdx);
      remaining.delete(bestIdx);
    }
  }

  return selected.map(i => candidates[i]);
}
