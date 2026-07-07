/**
 * Tests for composite similarity scoring and MMR diversity selection.
 */
import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  compositeSimilarity,
  buildSimilaritySql,
  diversitySelect,
  type CandidateRow,
  type VectorBundle,
} from '../../../src/archivist/utils/similarity.js';
import { retrievalWeights, retrievalNoEmbeddingWeights } from '../../../src/archivist/types.js';

/** Build a CandidateRow with sensible defaults, overridable per test */
function makeCandidate(overrides: Partial<CandidateRow>): CandidateRow {
  return {
    game_id: 'game-a',
    turn: 100,
    player_id: 0,
    civilization: 'Rome',
    era: 'Medieval',
    grand_strategy: null,
    is_winner: false,
    situation_abstract: null,
    decision_abstract: null,
    situation: null,
    decisions: null,
    science_per_pop: null,
    culture_per_pop: null,
    production_per_pop: null,
    gold_per_pop: null,
    tourism_share: null,
    military_share: null,
    population_share: null,
    cities_share: null,
    minor_allies_share: null,
    religion_percentage: 0,
    war_weariness: 0,
    active_wars: 0,
    truces: 0,
    domination_progress: null,
    science_progress: null,
    culture_progress: null,
    diplomatic_progress: null,
    supply_utilization: null,
    game_state_vector: [1, 0, 0],
    neighbor_vector: [1, 0, 0],
    situation_abstract_embedding: null,
    victory_type: null,
    score: 1,
    ...overrides,
  };
}

describe('cosineSimilarity', () => {
  it('should return 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('should return 0 for zero-magnitude vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });
});

describe('compositeSimilarity', () => {
  const base: VectorBundle = {
    gameStateVector: [1, 0],
    neighborVector: [0, 1],
    embedding: [1, 1],
  };

  it('should score identical bundles with embeddings as the sum of all weights', () => {
    const total = retrievalWeights.gameState + retrievalWeights.neighbor + retrievalWeights.embedding;
    expect(compositeSimilarity(base, base)).toBeCloseTo(total);
  });

  it('should fall back to no-embedding weights when an embedding is missing', () => {
    const noEmb: VectorBundle = { gameStateVector: [1, 0], neighborVector: [0, 1], embedding: null };
    const total = retrievalNoEmbeddingWeights.gameState + retrievalNoEmbeddingWeights.neighbor;
    expect(compositeSimilarity(noEmb, noEmb)).toBeCloseTo(total);
    // One-sided embedding also falls back
    expect(compositeSimilarity(base, noEmb)).toBeCloseTo(total);
  });

  it('should honor explicitly provided weights', () => {
    const weights = { gameState: 1, neighbor: 0, embedding: 0 };
    const other: VectorBundle = { gameStateVector: [1, 0], neighborVector: [1, 0], embedding: null };
    expect(compositeSimilarity(base, other, weights)).toBeCloseTo(1);
  });

  it('should skip the embedding term when explicit weights demand it but an embedding is missing', () => {
    // Explicit weights bypass the no-embedding fallback, so the embedding
    // contribution silently drops to 0 rather than being redistributed.
    const noEmb: VectorBundle = { gameStateVector: [1, 0], neighborVector: [0, 1], embedding: null };
    const weights = { gameState: 0, neighbor: 0, embedding: 1 };
    expect(compositeSimilarity(base, noEmb, weights)).toBe(0);
  });
});

describe('buildSimilaritySql', () => {
  it('should include the embedding term when embeddings are available', () => {
    const sql = buildSimilaritySql(true);
    expect(sql).toContain('$query_gs');
    expect(sql).toContain('$query_nb');
    expect(sql).toContain('$query_emb');
    expect(sql).toContain(`${retrievalWeights.embedding} * COALESCE`);
  });

  it('should omit the embedding term without embeddings', () => {
    const sql = buildSimilaritySql(false);
    expect(sql).not.toContain('$query_emb');
    expect(sql).toContain(`${retrievalNoEmbeddingWeights.gameState} * list_cosine_similarity(game_state_vector, $query_gs)`);
  });
});

describe('diversitySelect', () => {
  it('should return all candidates when at or under the limit', () => {
    const candidates = [makeCandidate({ turn: 1 }), makeCandidate({ turn: 2 })];
    expect(diversitySelect(candidates, 2)).toEqual(candidates);
    expect(diversitySelect(candidates, 5)).toEqual(candidates);
  });

  it('should fall back to top-N when the max score is zero', () => {
    const candidates = [
      makeCandidate({ turn: 1, score: 0 }),
      makeCandidate({ turn: 2, score: 0 }),
      makeCandidate({ turn: 3, score: 0 }),
    ];
    const result = diversitySelect(candidates, 2);
    expect(result).toEqual(candidates.slice(0, 2));
  });

  it('should always keep the top-scored candidate first', () => {
    const candidates = [
      makeCandidate({ game_id: 'a', score: 1 }),
      makeCandidate({ game_id: 'b', score: 0.5, game_state_vector: [0, 1, 0], neighbor_vector: [0, 1, 0] }),
      makeCandidate({ game_id: 'c', score: 0.4, game_state_vector: [0, 0, 1], neighbor_vector: [0, 0, 1] }),
    ];
    const result = diversitySelect(candidates, 2);
    expect(result[0]).toBe(candidates[0]);
    expect(result).toHaveLength(2);
  });

  it('should penalize candidates from the same game and player', () => {
    // Near-duplicate of the top pick (same game+player, near-identical score)
    // loses to a lower-scored but distinct episode.
    const candidates = [
      makeCandidate({ game_id: 'a', player_id: 0, score: 1 }),
      makeCandidate({ game_id: 'a', player_id: 0, score: 0.99 }),
      makeCandidate({
        game_id: 'b',
        player_id: 1,
        score: 0.6,
        game_state_vector: [0, 1, 0],
        neighbor_vector: [0, 1, 0],
      }),
    ];
    const result = diversitySelect(candidates, 2);
    expect(result.map(c => c.game_id)).toEqual(['a', 'b']);
  });

  it('should not apply the same-game penalty for a different player in the same game', () => {
    // Same game but a different player: no 1.5 floor on similarity, so the
    // higher-scored orthogonal candidate from the same game wins.
    const candidates = [
      makeCandidate({ game_id: 'a', player_id: 0, score: 1 }),
      makeCandidate({
        game_id: 'a',
        player_id: 1,
        score: 0.9,
        game_state_vector: [0, 1, 0],
        neighbor_vector: [0, 1, 0],
      }),
      makeCandidate({
        game_id: 'b',
        player_id: 2,
        score: 0.5,
        game_state_vector: [0, 0, 1],
        neighbor_vector: [0, 0, 1],
      }),
    ];
    const result = diversitySelect(candidates, 2);
    expect(result.map(c => c.player_id)).toEqual([0, 1]);
  });

  it('should balance winners and losers via the imbalance penalty', () => {
    // After selecting a winner, a slightly lower-scored loser beats another winner.
    const candidates = [
      makeCandidate({ game_id: 'a', is_winner: true, score: 1 }),
      makeCandidate({
        game_id: 'b',
        is_winner: true,
        score: 0.95,
        game_state_vector: [0, 1, 0],
        neighbor_vector: [0, 1, 0],
      }),
      makeCandidate({
        game_id: 'c',
        is_winner: false,
        score: 0.9,
        game_state_vector: [0, 0, 1],
        neighbor_vector: [0, 0, 1],
      }),
    ];
    const result = diversitySelect(candidates, 2);
    expect(result.map(c => c.game_id)).toEqual(['a', 'c']);
  });

  it('should return exactly resultLimit candidates from a larger pool', () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeCandidate({
        game_id: `game-${i}`,
        player_id: i,
        score: 1 - i * 0.05,
        game_state_vector: [Math.cos(i), Math.sin(i), 0],
        neighbor_vector: [Math.sin(i), Math.cos(i), 0],
      })
    );
    const result = diversitySelect(candidates, 4);
    expect(result).toHaveLength(4);
    // No duplicates
    expect(new Set(result.map(c => c.game_id)).size).toBe(4);
  });
});
