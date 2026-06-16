/**
 * Tests for the archivist diversity-first landmark selector.
 * Drives selectLandmarks against a FAKE EpisodeWriter (vi.fn-backed) that returns
 * canned vector rows, so no DuckDB is needed.
 *
 * Structural assertions only: grouping/selection by player, turn-0 exclusion,
 * the marked (turn, playerId) keys, the null branch, and stable stats numbers.
 * No logger text is asserted.
 */
import { describe, it, expect, vi } from 'vitest';
import { selectLandmarks } from '../../../src/archivist/pipeline/selector.js';
import type { EpisodeWriter } from '../../../src/archivist/pipeline/writer.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface VectorRow {
  turn: number;
  playerId: number;
  gameStateVector: number[];
  neighborVector: number[];
  situationAbstractEmbedding: number[] | null;
}

/** Build a vector row; vectors default to a distinct, finite shape. */
function makeRow(overrides: Partial<VectorRow> & { turn: number; playerId: number }): VectorRow {
  return {
    gameStateVector: [1, 0, 0],
    neighborVector: [1, 0, 0],
    situationAbstractEmbedding: null,
    ...overrides,
  };
}

/** Fake EpisodeWriter exposing only the methods selectLandmarks invokes. */
function makeFakeWriter(rows: VectorRow[]) {
  const getGameEpisodeVectors = vi.fn(async () => rows);
  const markLandmarks = vi.fn(async () => {});
  const writer = { getGameEpisodeVectors, markLandmarks } as unknown as EpisodeWriter;
  return { writer, getGameEpisodeVectors, markLandmarks };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('selectLandmarks', () => {
  describe('null / empty branch', () => {
    it('should return null and never mark when there are no vectors', async () => {
      const { writer, markLandmarks } = makeFakeWriter([]);
      const result = await selectLandmarks(writer, 'g1');
      expect(result).toBeNull();
      expect(markLandmarks).not.toHaveBeenCalled();
    });
  });

  describe('grouping by player', () => {
    it('should report one player-stat entry per distinct player', async () => {
      // Diverse vectors so each player yields at least one landmark.
      const rows = [
        makeRow({ turn: 1, playerId: 0, gameStateVector: [1, 0, 0], neighborVector: [1, 0, 0] }),
        makeRow({ turn: 2, playerId: 0, gameStateVector: [0, 1, 0], neighborVector: [0, 1, 0] }),
        makeRow({ turn: 1, playerId: 1, gameStateVector: [0, 0, 1], neighborVector: [0, 0, 1] }),
        makeRow({ turn: 2, playerId: 1, gameStateVector: [1, 1, 0], neighborVector: [1, 1, 0] }),
      ];
      const { writer } = makeFakeWriter(rows);
      const result = await selectLandmarks(writer, 'g1');
      expect(result).not.toBeNull();
      expect(result!.players.map(p => p.playerId).sort()).toEqual([0, 1]);
      expect(result!.totalEpisodes).toBe(4);
      // Marked keys only ever reference real players.
      for (const p of result!.players) {
        expect([0, 1]).toContain(p.playerId);
      }
    });

    it('should pass exactly the selected keys to markLandmarks', async () => {
      const rows = [
        makeRow({ turn: 1, playerId: 0, gameStateVector: [1, 0, 0], neighborVector: [1, 0, 0] }),
        makeRow({ turn: 2, playerId: 0, gameStateVector: [0, 1, 0], neighborVector: [0, 1, 0] }),
        makeRow({ turn: 3, playerId: 0, gameStateVector: [0, 0, 1], neighborVector: [0, 0, 1] }),
      ];
      const { writer, markLandmarks } = makeFakeWriter(rows);
      const result = await selectLandmarks(writer, 'g1');

      expect(markLandmarks).toHaveBeenCalledTimes(1);
      const [gameId, keys] = markLandmarks.mock.calls[0] as unknown as [string, Array<{ turn: number; playerId: number }>];
      expect(gameId).toBe('g1');
      // The reported totalLandmarks equals the number of marked keys.
      expect(keys).toHaveLength(result!.totalLandmarks);
      // Every key references a turn that existed for player 0.
      for (const k of keys) {
        expect(k.playerId).toBe(0);
        expect([1, 2, 3]).toContain(k.turn);
      }
      // No duplicate keys.
      const seen = new Set(keys.map(k => `${k.turn}:${k.playerId}`));
      expect(seen.size).toBe(keys.length);
    });
  });

  describe('turn-0 exclusion', () => {
    it('should never select turn 0 when other turns exist', async () => {
      const rows = [
        makeRow({ turn: 0, playerId: 0, gameStateVector: [5, 5, 5], neighborVector: [5, 5, 5] }),
        makeRow({ turn: 1, playerId: 0, gameStateVector: [1, 0, 0], neighborVector: [1, 0, 0] }),
        makeRow({ turn: 2, playerId: 0, gameStateVector: [0, 1, 0], neighborVector: [0, 1, 0] }),
        makeRow({ turn: 3, playerId: 0, gameStateVector: [0, 0, 1], neighborVector: [0, 0, 1] }),
      ];
      const { writer, markLandmarks } = makeFakeWriter(rows);
      const result = await selectLandmarks(writer, 'g1');

      const [, keys] = markLandmarks.mock.calls[0] as unknown as [string, Array<{ turn: number; playerId: number }>];
      expect(keys.every(k => k.turn !== 0)).toBe(true);
      // Filtered candidates exclude turn 0, so reported episodes for player 0 is 3.
      const p0 = result!.players.find(p => p.playerId === 0)!;
      expect(p0.episodes).toBe(3);
    });

    it('should keep turn 0 only when it is the sole episode for the player', async () => {
      // selector only filters when filtered.length > 0, so a lone turn-0 stays.
      const rows = [makeRow({ turn: 0, playerId: 0 })];
      const { writer, markLandmarks } = makeFakeWriter(rows);
      const result = await selectLandmarks(writer, 'g1');

      const [, keys] = markLandmarks.mock.calls[0] as unknown as [string, Array<{ turn: number; playerId: number }>];
      const p0 = result!.players.find(p => p.playerId === 0)!;
      expect(p0.episodes).toBe(1);
      expect(keys).toEqual([{ turn: 0, playerId: 0 }]);
    });
  });

  describe('stats', () => {
    it('should report consistent totals and per-player counts', async () => {
      const rows = [
        makeRow({ turn: 1, playerId: 0, gameStateVector: [1, 0, 0], neighborVector: [1, 0, 0] }),
        makeRow({ turn: 2, playerId: 0, gameStateVector: [0, 1, 0], neighborVector: [0, 1, 0] }),
        makeRow({ turn: 1, playerId: 7, gameStateVector: [0, 0, 1], neighborVector: [0, 0, 1] }),
      ];
      const { writer } = makeFakeWriter(rows);
      const result = await selectLandmarks(writer, 'g1');

      expect(result!.totalEpisodes).toBe(3);
      // Aggregate landmarks equals the sum of per-player landmark counts.
      const sumLandmarks = result!.players.reduce((s, p) => s + p.landmarks, 0);
      expect(result!.totalLandmarks).toBe(sumLandmarks);
      // Each player always has at least one landmark (targetCount >= 1).
      for (const p of result!.players) {
        expect(p.landmarks).toBeGreaterThanOrEqual(1);
        expect(p.landmarks).toBeLessThanOrEqual(p.episodes);
      }
    });

    it('should report null distances for a single-landmark player', async () => {
      // One episode -> targetCount 1 -> only the seed, no greedy additions -> distances null.
      const rows = [makeRow({ turn: 5, playerId: 0 })];
      const { writer } = makeFakeWriter(rows);
      const result = await selectLandmarks(writer, 'g1');

      const p0 = result!.players.find(p => p.playerId === 0)!;
      expect(p0.landmarks).toBe(1);
      expect(p0.distances).toBeNull();
    });

    it('should expose finite ordered distance stats when multiple landmarks are chosen', async () => {
      // 20 distinct directions for one player -> targetCount round(20/10)=2 -> >=1 greedy addition.
      const rows = Array.from({ length: 20 }, (_, i) =>
        makeRow({
          turn: i + 1,
          playerId: 0,
          gameStateVector: [Math.cos(i), Math.sin(i), i * 0.01],
          neighborVector: [Math.sin(i), Math.cos(i), i * 0.01],
        })
      );
      const { writer } = makeFakeWriter(rows);
      const result = await selectLandmarks(writer, 'g1');

      const p0 = result!.players.find(p => p.playerId === 0)!;
      expect(p0.episodes).toBe(20);
      if (p0.distances) {
        const { min, median, max } = p0.distances;
        for (const v of [min, median, max]) expect(Number.isFinite(v)).toBe(true);
        expect(min).toBeLessThanOrEqual(median);
        expect(median).toBeLessThanOrEqual(max);
      }
    });
  });
});
