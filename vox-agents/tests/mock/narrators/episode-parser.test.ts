import { describe, it, expect } from 'vitest';
import { parseSegments, segmentsToEpisodes, parseAndDecompose } from '../../../src/narrators/utils/episode-parser.js';
import type { Segment } from '../../../src/narrators/types.js';

// Helper to build a JSONL string from entries
function toJsonl(entries: Record<string, unknown>[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n');
}

describe('episode-parser', () => {
  describe('parseSegments', () => {
    it('should parse a simple start-stop segment', () => {
      const content = toJsonl([
        { event: 'start', turn: 1, playerID: 0, at: 1000 },
        { event: 'stop', turn: 1, playerID: 0, at: 5000, file: 'video1.mkv' },
      ]);
      const segments = parseSegments(content);
      expect(segments).toHaveLength(1);
      expect(segments[0].startAt).toBe(1000);
      expect(segments[0].stopAt).toBe(5000);
      expect(segments[0].sourceFile).toBe('video1.mkv');
      expect(segments[0].entries).toHaveLength(2);
    });

    it('should parse a segment with multiple switches', () => {
      const content = toJsonl([
        { event: 'start', turn: 10, playerID: 0, at: 1000 },
        { event: 'switch', turn: 10, playerID: 1, at: 3000 },
        { event: 'switch', turn: 10, playerID: 2, at: 6000 },
        { event: 'stop', turn: 10, playerID: 2, at: 9000, file: 'video2.mkv' },
      ]);
      const segments = parseSegments(content);
      expect(segments).toHaveLength(1);
      expect(segments[0].entries).toHaveLength(4);
    });

    it('should handle multiple segments', () => {
      const content = toJsonl([
        { event: 'start', turn: 1, playerID: 0, at: 1000 },
        { event: 'stop', turn: 1, playerID: 0, at: 5000, file: 'video1.mkv' },
        { event: 'start', turn: 2, playerID: 0, at: 6000 },
        { event: 'stop', turn: 2, playerID: 0, at: 10000, file: 'video2.mkv' },
      ]);
      const segments = parseSegments(content);
      expect(segments).toHaveLength(2);
      expect(segments[0].sourceFile).toBe('video1.mkv');
      expect(segments[1].sourceFile).toBe('video2.mkv');
    });

    it('should discard segment with missing stop (trailing at EOF)', () => {
      const content = toJsonl([
        { event: 'start', turn: 1, playerID: 0, at: 1000 },
        { event: 'switch', turn: 1, playerID: 1, at: 3000 },
      ]);
      const segments = parseSegments(content);
      expect(segments).toHaveLength(0);
    });

    it('should discard incomplete segment when start appears mid-segment', () => {
      const content = toJsonl([
        { event: 'start', turn: 1, playerID: 0, at: 1000 },
        { event: 'switch', turn: 1, playerID: 1, at: 3000 },
        // New start before stop — previous segment discarded
        { event: 'start', turn: 2, playerID: 0, at: 5000 },
        { event: 'stop', turn: 2, playerID: 0, at: 8000, file: 'video2.mkv' },
      ]);
      const segments = parseSegments(content);
      expect(segments).toHaveLength(1);
      expect(segments[0].startAt).toBe(5000);
    });

    it('should skip malformed JSON lines', () => {
      const content = [
        JSON.stringify({ event: 'start', turn: 1, playerID: 0, at: 1000 }),
        'this is not json',
        JSON.stringify({ event: 'stop', turn: 1, playerID: 0, at: 5000, file: 'video.mkv' }),
      ].join('\n');
      const segments = parseSegments(content);
      expect(segments).toHaveLength(1);
    });

    it('should return empty for empty input', () => {
      expect(parseSegments('')).toHaveLength(0);
      expect(parseSegments('  \n  \n  ')).toHaveLength(0);
    });

    it('should discard segment with no stop.file', () => {
      const content = toJsonl([
        { event: 'start', turn: 1, playerID: 0, at: 1000 },
        { event: 'stop', turn: 1, playerID: 0, at: 5000 },
        // No file field on stop
      ]);
      const segments = parseSegments(content);
      expect(segments).toHaveLength(0);
    });

    it('should ignore orphaned switch and stop events', () => {
      const content = toJsonl([
        { event: 'switch', turn: 1, playerID: 1, at: 500 },
        { event: 'stop', turn: 1, playerID: 0, at: 800, file: 'orphan.mkv' },
        { event: 'start', turn: 2, playerID: 0, at: 1000 },
        { event: 'stop', turn: 2, playerID: 0, at: 5000, file: 'video.mkv' },
      ]);
      const segments = parseSegments(content);
      expect(segments).toHaveLength(1);
      expect(segments[0].startAt).toBe(1000);
    });
  });

  describe('segmentsToEpisodes', () => {
    const emptyMinors = new Set<number>();

    it('should create single episode from start-stop segment', () => {
      const segments: Segment[] = [{
        entries: [
          { event: 'start', turn: 1, playerID: 0, at: 1000 },
          { event: 'stop', turn: 1, playerID: 0, at: 5000, file: 'video.mkv' },
        ],
        startAt: 1000,
        stopAt: 5000,
        sourceFile: 'video.mkv',
      }];
      const episodes = segmentsToEpisodes(segments, emptyMinors);
      expect(episodes).toHaveLength(1);
      expect(episodes[0]).toMatchObject({
        turn: 1,
        playerID: 0,
        sourceFile: 'video.mkv',
        offset: 0,
        duration: 4000,
      });
    });

    it('should split on switch boundaries with correct offsets', () => {
      const segments: Segment[] = [{
        entries: [
          { event: 'start', turn: 5, playerID: 0, at: 10000 },
          { event: 'switch', turn: 5, playerID: 1, at: 13000 },
          { event: 'switch', turn: 5, playerID: 2, at: 18000 },
          { event: 'stop', turn: 5, playerID: 2, at: 25000, file: 'seg.mkv' },
        ],
        startAt: 10000,
        stopAt: 25000,
        sourceFile: 'seg.mkv',
      }];
      const episodes = segmentsToEpisodes(segments, emptyMinors);
      expect(episodes).toHaveLength(3);
      expect(episodes[0]).toMatchObject({ playerID: 0, offset: 0, duration: 3000 });
      expect(episodes[1]).toMatchObject({ playerID: 1, offset: 3000, duration: 5000 });
      expect(episodes[2]).toMatchObject({ playerID: 2, offset: 8000, duration: 7000 });
    });

    it('should handle zero-duration episodes', () => {
      const segments: Segment[] = [{
        entries: [
          { event: 'start', turn: 1, playerID: 0, at: 1000 },
          { event: 'switch', turn: 1, playerID: 1, at: 1000 }, // same timestamp
          { event: 'stop', turn: 1, playerID: 1, at: 5000, file: 'v.mkv' },
        ],
        startAt: 1000,
        stopAt: 5000,
        sourceFile: 'v.mkv',
      }];
      const episodes = segmentsToEpisodes(segments, emptyMinors);
      expect(episodes).toHaveLength(2);
      expect(episodes[0].duration).toBe(0);
      expect(episodes[1].duration).toBe(4000);
    });

    it('should handle multiple segments with different source files', () => {
      const segments: Segment[] = [
        {
          entries: [
            { event: 'start', turn: 1, playerID: 0, at: 1000 },
            { event: 'stop', turn: 1, playerID: 0, at: 5000, file: 'a.mkv' },
          ],
          startAt: 1000, stopAt: 5000, sourceFile: 'a.mkv',
        },
        {
          entries: [
            { event: 'start', turn: 2, playerID: 0, at: 6000 },
            { event: 'stop', turn: 2, playerID: 0, at: 10000, file: 'b.mkv' },
          ],
          startAt: 6000, stopAt: 10000, sourceFile: 'b.mkv',
        },
      ];
      const episodes = segmentsToEpisodes(segments, emptyMinors);
      expect(episodes).toHaveLength(2);
      expect(episodes[0].sourceFile).toBe('a.mkv');
      expect(episodes[1].sourceFile).toBe('b.mkv');
      // Each segment resets offsets independently
      expect(episodes[0].offset).toBe(0);
      expect(episodes[1].offset).toBe(0);
    });

    it('should rewrite minor civ playerIDs to -1', () => {
      const minors = new Set([5, 6]);
      const segments: Segment[] = [{
        entries: [
          { event: 'start', turn: 3, playerID: 0, at: 1000 },
          { event: 'switch', turn: 3, playerID: 5, at: 2000 },
          { event: 'switch', turn: 3, playerID: 1, at: 3000 },
          { event: 'stop', turn: 3, playerID: 1, at: 6000, file: 'v.mkv' },
        ],
        startAt: 1000, stopAt: 6000, sourceFile: 'v.mkv',
      }];
      const episodes = segmentsToEpisodes(segments, minors);
      expect(episodes).toHaveLength(3);
      expect(episodes[0].playerID).toBe(0);  // major
      expect(episodes[1].playerID).toBe(-1); // minor civ 5 → -1
      expect(episodes[2].playerID).toBe(1);  // major
    });

    it('should initialize eventCounts as empty objects', () => {
      const segments: Segment[] = [{
        entries: [
          { event: 'start', turn: 1, playerID: 0, at: 1000 },
          { event: 'stop', turn: 1, playerID: 0, at: 5000, file: 'v.mkv' },
        ],
        startAt: 1000, stopAt: 5000, sourceFile: 'v.mkv',
      }];
      const episodes = segmentsToEpisodes(segments, emptyMinors);
      expect(episodes[0].eventCounts).toEqual({});
    });
  });

  describe('parseAndDecompose', () => {
    it('should produce correct episodes from realistic JSONL input', () => {
      const content = toJsonl([
        { event: 'start', turn: 42, playerID: 3, at: 1700000000000 },
        { event: 'switch', turn: 42, playerID: 5, at: 1700000005000 },
        { event: 'stop', turn: 42, playerID: 5, at: 1700000020000, file: 'game42.mkv' },
      ]);
      const episodes = parseAndDecompose(content, new Set<number>());
      expect(episodes).toHaveLength(2);
      expect(episodes[0]).toMatchObject({
        turn: 42,
        playerID: 3,
        sourceFile: 'game42.mkv',
        offset: 0,
        duration: 5000,
      });
      expect(episodes[1]).toMatchObject({
        turn: 42,
        playerID: 5,
        sourceFile: 'game42.mkv',
        offset: 5000,
        duration: 15000,
      });
    });

    it('should match the wall-clock to file-relative conversion example from spec', () => {
      // From stage-1-assemble.md:
      // segment start.at = 1700000000000
      // switch.at        = 1700000005000
      // stop.at          = 1700000020000
      // Episode 1: offset = 0,    duration = 5000
      // Episode 2: offset = 5000, duration = 15000
      const content = toJsonl([
        { event: 'start', turn: 1, playerID: 0, at: 1700000000000 },
        { event: 'switch', turn: 1, playerID: 1, at: 1700000005000 },
        { event: 'stop', turn: 1, playerID: 1, at: 1700000020000, file: 'rec.mkv' },
      ]);
      const episodes = parseAndDecompose(content, new Set<number>());
      expect(episodes[0].offset).toBe(0);
      expect(episodes[0].duration).toBe(5000);
      expect(episodes[1].offset).toBe(5000);
      expect(episodes[1].duration).toBe(15000);
    });

    it('should handle minor civs in combined flow', () => {
      const content = toJsonl([
        { event: 'start', turn: 10, playerID: 2, at: 1000 },
        { event: 'switch', turn: 10, playerID: 22, at: 2000 }, // minor civ
        { event: 'switch', turn: 10, playerID: 3, at: 2500 },
        { event: 'stop', turn: 10, playerID: 3, at: 5000, file: 'v.mkv' },
      ]);
      const minors = new Set([22, 23]);
      const episodes = parseAndDecompose(content, minors);
      expect(episodes).toHaveLength(3);
      expect(episodes[0].playerID).toBe(2);
      expect(episodes[1].playerID).toBe(-1); // minor → -1
      expect(episodes[2].playerID).toBe(3);
    });
  });
});
