/**
 * Mock-tier unit tests for NarratorWorkspace (src/narrators/workspace.ts).
 *
 * NarratorWorkspace manages a shared on-disk workspace directory: the context
 * file (narrator-context.json) and the episodes manifest (episodes.json). Tests
 * use a unique temp directory per case and assert real on-disk behavior:
 * file/path layout, context read/write round-trips and missing-file throws,
 * episodes read/write with the null case, and openGameDb success/failure with
 * the knowledge-DB opener (openReadonlyGameDb) mocked via a hoisted factory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../src/utils/telemetry/knowledge-db.js', () => ({
  openReadonlyGameDb: vi.fn(),
}));

import { openReadonlyGameDb } from '../../../src/utils/telemetry/knowledge-db.js';
import { NarratorWorkspace } from '../../../src/narrators/workspace.js';
import type { NarratorContext, Episodes } from '../../../src/narrators/types.js';

const CONTEXT_FILE = 'narrator-context.json';
const EPISODES_FILE = 'episodes.json';

function makeContext(overrides: Partial<NarratorContext> = {}): NarratorContext {
  return {
    gameID: 'test-game',
    knowledgePath: path.join('/tmp', 'knowledge', 'test-game.db'),
    recordingDir: path.join('/tmp', 'recordings', 'test-game'),
    ...overrides,
  };
}

function makeEpisodes(overrides: Partial<Episodes> = {}): Episodes {
  return {
    gameID: 'test-game',
    totalTurns: 2,
    players: [],
    playerTypes: { 0: 'Human' },
    episodes: [
      {
        turn: 1,
        playerID: 0,
        sourceFile: 'video1.mkv',
        offset: 0,
        duration: 5000,
        eventCounts: {},
      },
    ],
    ...overrides,
  };
}

describe('NarratorWorkspace', () => {
  let workspaceDir: string;
  let ws: NarratorWorkspace;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrator-ws-'));
    ws = new NarratorWorkspace(workspaceDir);
    vi.mocked(openReadonlyGameDb).mockReset();
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe('directory and path layout', () => {
    it('should resolve filenames within the workspace via getPath', () => {
      expect(ws.getPath(CONTEXT_FILE)).toBe(path.join(workspaceDir, CONTEXT_FILE));
      expect(ws.getPath('sub/file.json')).toBe(path.join(workspaceDir, 'sub/file.json'));
    });

    it('should create the workspace directory recursively via ensureDir', () => {
      const nested = path.join(workspaceDir, 'a', 'b', 'c');
      const nestedWs = new NarratorWorkspace(nested);
      expect(fs.existsSync(nested)).toBe(false);
      nestedWs.ensureDir();
      expect(fs.existsSync(nested)).toBe(true);
      expect(fs.statSync(nested).isDirectory()).toBe(true);
    });

    it('should be idempotent when the directory already exists', () => {
      expect(() => ws.ensureDir()).not.toThrow();
      expect(() => ws.ensureDir()).not.toThrow();
      expect(fs.existsSync(workspaceDir)).toBe(true);
    });
  });

  describe('context management', () => {
    it('should round-trip a context through writeContext/getContext', () => {
      const ctx = makeContext();
      ws.writeContext(ctx);
      expect(ws.getContext()).toEqual(ctx);
    });

    it('should write the context to narrator-context.json on disk', () => {
      const ctx = makeContext();
      ws.writeContext(ctx);
      const filePath = path.join(workspaceDir, CONTEXT_FILE);
      expect(fs.existsSync(filePath)).toBe(true);
      const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(onDisk).toEqual(ctx);
    });

    it('should report context presence via hasContext', () => {
      expect(ws.hasContext()).toBe(false);
      ws.writeContext(makeContext());
      expect(ws.hasContext()).toBe(true);
    });

    it('should throw a helpful error when reading a missing context', () => {
      expect(() => ws.getContext()).toThrow(/Narrator context not found/);
      expect(() => ws.getContext()).toThrow(/Run Stage 1/);
    });
  });

  describe('episodes I/O', () => {
    it('should return null when episodes.json has not been produced', () => {
      expect(ws.readEpisodes()).toBeNull();
    });

    it('should round-trip episodes through writeEpisodes/readEpisodes', () => {
      const episodes = makeEpisodes();
      ws.writeEpisodes(episodes);
      expect(ws.readEpisodes()).toEqual(episodes);
    });

    it('should write episodes to episodes.json on disk', () => {
      const episodes = makeEpisodes();
      ws.writeEpisodes(episodes);
      const filePath = path.join(workspaceDir, EPISODES_FILE);
      expect(fs.existsSync(filePath)).toBe(true);
      const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(onDisk).toEqual(episodes);
    });

    it('should round-trip an empty episodes manifest', () => {
      const episodes = makeEpisodes({ episodes: [], totalTurns: 0 });
      ws.writeEpisodes(episodes);
      const result = ws.readEpisodes();
      expect(result).not.toBeNull();
      expect(result!.episodes).toEqual([]);
    });
  });

  describe('openGameDb', () => {
    it('should open the DB at the context knowledgePath on success', () => {
      const ctx = makeContext({ knowledgePath: '/tmp/knowledge/my-game.db' });
      ws.writeContext(ctx);
      const fakeDb = { TAG: 'knowledge-db' } as any;
      vi.mocked(openReadonlyGameDb).mockReturnValue(fakeDb);

      const db = ws.openGameDb();

      expect(db).toBe(fakeDb);
      expect(openReadonlyGameDb).toHaveBeenCalledWith('/tmp/knowledge/my-game.db');
      expect(openReadonlyGameDb).toHaveBeenCalledTimes(1);
    });

    it('should throw when the DB opener returns null', () => {
      const ctx = makeContext({ knowledgePath: '/tmp/knowledge/bad.db' });
      ws.writeContext(ctx);
      vi.mocked(openReadonlyGameDb).mockReturnValue(null);

      expect(() => ws.openGameDb()).toThrow(/Failed to open knowledge DB at \/tmp\/knowledge\/bad\.db/);
    });

    it('should throw the missing-context error before attempting to open the DB', () => {
      // No context written.
      expect(() => ws.openGameDb()).toThrow(/Narrator context not found/);
      expect(openReadonlyGameDb).not.toHaveBeenCalled();
    });
  });
});
