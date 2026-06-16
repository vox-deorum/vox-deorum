/**
 * Tests for oracle output helpers: path resolution, trail naming, CSV writing,
 * replay-cache reading, and trail file writing.
 *
 * Assertion-stability rule: we assert parsed CSV fields/columns, JSON structure,
 * file existence, and defaults/legacy tolerance — never snapshot whole CSV or
 * markdown strings.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Papa from 'papaparse';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getTrailBase,
  getTrailPaths,
  readReplayCache,
  resolvePath,
  writeCsv,
  writeTrail,
} from '../../../src/oracle/utils/output.js';
import type { OracleRow, ReplayResult } from '../../../src/oracle/types.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-output-'));
  tempDirs.push(dir);
  return dir;
}

const baseRow: OracleRow = {
  game_id: 'game-1',
  player_id: '2',
  turn: '30',
  player_type: 'Test',
  rationale: 'original rationale',
};

/** A minimal ReplayResult for CSV writing tests. */
function makeResult(overrides: Partial<ReplayResult> = {}): ReplayResult {
  return {
    row: baseRow,
    model: 'test/model',
    decisions: [
      { toolName: 'set-flavors', args: { GrandStrategy: 'Conquest' }, rationale: 'replay rationale' },
    ],
    tokens: { inputTokens: 10, reasoningTokens: 20, outputTokens: 30 },
    messages: [{ role: 'assistant', content: 'response' }],
    ...overrides,
  };
}

describe('oracle output helpers', () => {
  describe('resolvePath', () => {
    it('returns an absolute path unchanged', () => {
      const abs = path.resolve('/some/absolute/path');
      expect(resolvePath(abs)).toBe(abs);
    });

    it('resolves a relative path against cwd', () => {
      expect(resolvePath('foo/bar.csv')).toBe(path.resolve(process.cwd(), 'foo/bar.csv'));
    });
  });

  describe('getTrailBase / getTrailPaths', () => {
    it('builds a stable base name with parsed integer turn', () => {
      const base = getTrailBase({ game_id: 'g1', player_id: '5', turn: '030' }, '');
      expect(base).toBe('g1-p5-t30');
    });

    it('appends the trail suffix to the base name', () => {
      const base = getTrailBase({ game_id: 'g1', player_id: '5', turn: '30' }, '-ModelName');
      expect(base).toBe('g1-p5-t30-ModelName');
    });

    it('derives json and md paths from the experiment dir and base', () => {
      const { jsonPath, mdPath } = getTrailPaths('/exp', 'g1-p5-t30');
      expect(jsonPath).toBe(path.join('/exp', 'g1-p5-t30.json'));
      expect(mdPath).toBe(path.join('/exp', 'g1-p5-t30.md'));
    });
  });

  describe('writeCsv', () => {
    /** Parse the written CSV back into row objects for field-level assertions. */
    function parseCsv(file: string): { fields: string[]; rows: Record<string, string>[] } {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true });
      return { fields: parsed.meta.fields ?? [], rows: parsed.data };
    }

    it('writes core fields, renames rationale, and extracts replayRationale from decision tools', () => {
      const dir = makeTempDir();
      const out = path.join(dir, 'results.csv');
      writeCsv(out, [makeResult()]);

      const { fields, rows } = parseCsv(out);
      // The row's `rationale` is renamed to `originalRationale`.
      expect(fields).not.toContain('rationale');
      expect(fields).toContain('originalRationale');
      expect(rows[0].originalRationale).toBe('original rationale');
      expect(rows[0].game_id).toBe('game-1');
      expect(rows[0].model).toBe('test/model');
      // replayRationale pulled from the decision tool.
      expect(rows[0].replayRationale).toBe('replay rationale');
      // Token columns.
      expect(rows[0].input_tokens).toBe('10');
      expect(rows[0].reasoning_tokens).toBe('20');
      expect(rows[0].output_tokens).toBe('30');
    });

    it('leaves replayRationale empty when no decision tool matched', () => {
      const dir = makeTempDir();
      const out = path.join(dir, 'results.csv');
      const result = makeResult({
        decisions: [{ toolName: 'some-other-tool', args: {}, rationale: 'ignored' }],
      });
      writeCsv(out, [result]);

      const { rows } = parseCsv(out);
      expect(rows[0].replayRationale).toBe('');
    });

    it('includes error and repetition columns only when present', () => {
      const dir = makeTempDir();
      const out = path.join(dir, 'results.csv');
      writeCsv(out, [makeResult({ error: 'boom', repetition: 2 })]);

      const { fields, rows } = parseCsv(out);
      expect(fields).toContain('error');
      expect(fields).toContain('repetition');
      expect(rows[0].error).toBe('boom');
      expect(rows[0].repetition).toBe('2');
    });

    it('omits error and repetition columns when undefined', () => {
      const dir = makeTempDir();
      const out = path.join(dir, 'results.csv');
      writeCsv(out, [makeResult()]);

      const { fields } = parseCsv(out);
      expect(fields).not.toContain('error');
      expect(fields).not.toContain('repetition');
    });

    it('unions extractedColumns across rows so later-introduced columns are not dropped', () => {
      const dir = makeTempDir();
      const out = path.join(dir, 'results.csv');
      // First row has no extracted columns; second row introduces one.
      const first = makeResult();
      const second = makeResult({ extractedColumns: { replay_nuke: 80 } });
      writeCsv(out, [first, second]);

      const { fields, rows } = parseCsv(out);
      expect(fields).toContain('replay_nuke');
      // First row's missing column is blank, second carries the value.
      expect(rows[0].replay_nuke).toBe('');
      expect(rows[1].replay_nuke).toBe('80');
    });
  });

  describe('readReplayCache', () => {
    /** Write a trail JSON and return its path. */
    function writeTrailJson(dir: string, data: object): string {
      const p = path.join(dir, 'trail.json');
      fs.writeFileSync(p, JSON.stringify(data));
      return p;
    }

    it('reconstructs a full ReplayResult from a complete trail', () => {
      const dir = makeTempDir();
      const p = writeTrailJson(dir, {
        row: baseRow,
        model: 'test/cached-model',
        modifications: { metadata: { cached: true } },
        extractedColumns: { replay_nuke: 80 },
        replay: {
          decisions: [{ toolName: 'set-flavors', args: { GrandStrategy: 'Conquest' }, rationale: 'r' }],
          tokens: { inputTokens: 11, reasoningTokens: 22, outputTokens: 33 },
          messages: [{ role: 'assistant', content: 'cached' }],
        },
      });

      const result = readReplayCache(p);
      expect(result).toMatchObject({
        row: baseRow,
        model: 'test/cached-model',
        tokens: { inputTokens: 11, reasoningTokens: 22, outputTokens: 33 },
        metadata: { cached: true },
        extractedColumns: { replay_nuke: 80 },
      });
      expect(result.decisions).toHaveLength(1);
      expect(result.messages).toEqual([{ role: 'assistant', content: 'cached' }]);
    });

    it('defaults missing optional arrays and tokens (legacy tolerance)', () => {
      const dir = makeTempDir();
      // Minimal legacy trail: only the core required payload, no tokens/decisions/messages.
      const p = writeTrailJson(dir, {
        row: baseRow,
        model: 'test/legacy',
        replay: {},
      });

      const result = readReplayCache(p);
      expect(result.decisions).toEqual([]);
      expect(result.messages).toEqual([]);
      expect(result.tokens).toEqual({ inputTokens: 0, reasoningTokens: 0, outputTokens: 0 });
      expect(result.metadata).toBeUndefined();
      expect(result.extractedColumns).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('coerces non-finite token values to zero', () => {
      const dir = makeTempDir();
      const p = writeTrailJson(dir, {
        row: baseRow,
        model: 'test/legacy',
        replay: { tokens: { inputTokens: 'oops', reasoningTokens: null } },
      });

      const result = readReplayCache(p);
      expect(result.tokens).toEqual({ inputTokens: 0, reasoningTokens: 0, outputTokens: 0 });
    });

    it('carries a string error field through', () => {
      const dir = makeTempDir();
      const p = writeTrailJson(dir, {
        row: baseRow,
        model: 'test/legacy',
        error: 'cached error',
        replay: {},
      });
      expect(readReplayCache(p).error).toBe('cached error');
    });

    it('throws when the trail is not a JSON object', () => {
      const dir = makeTempDir();
      const p = writeTrailJson(dir, [1, 2, 3] as unknown as object);
      expect(() => readReplayCache(p)).toThrow('Oracle replay cache must be a JSON object');
    });

    it('throws when replay data is missing', () => {
      const dir = makeTempDir();
      const p = writeTrailJson(dir, { row: baseRow, model: 'm' });
      expect(() => readReplayCache(p)).toThrow('Oracle replay cache is missing replay data');
    });

    it('throws when row data is missing', () => {
      const dir = makeTempDir();
      const p = writeTrailJson(dir, { model: 'm', replay: {} });
      expect(() => readReplayCache(p)).toThrow('Oracle replay cache is missing row data');
    });

    it('throws when model data is missing', () => {
      const dir = makeTempDir();
      const p = writeTrailJson(dir, { row: baseRow, replay: {} });
      expect(() => readReplayCache(p)).toThrow('Oracle replay cache is missing model data');
    });
  });

  describe('writeTrail', () => {
    it('creates both a JSON and a markdown file', () => {
      const dir = makeTempDir();
      const data = { row: baseRow, model: 'test/model', replay: { tokens: { inputTokens: 1 } } };
      writeTrail(dir, 'g1-p2-t30', data);

      const { jsonPath, mdPath } = getTrailPaths(dir, 'g1-p2-t30');
      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(mdPath)).toBe(true);
    });

    it('writes round-trippable JSON for the payload', () => {
      const dir = makeTempDir();
      const data = { row: baseRow, model: 'test/model', replay: { tokens: { inputTokens: 7 } } };
      writeTrail(dir, 'g1-p2-t30', data);

      const parsed = JSON.parse(fs.readFileSync(getTrailPaths(dir, 'g1-p2-t30').jsonPath, 'utf-8'));
      // Assert structure, not the exact serialized string.
      expect(parsed.row.game_id).toBe('game-1');
      expect(parsed.model).toBe('test/model');
      expect(parsed.replay.tokens.inputTokens).toBe(7);
    });

    it('writes a non-empty markdown file (without snapshotting prose)', () => {
      const dir = makeTempDir();
      writeTrail(dir, 'g1-p2-t30', { row: baseRow, model: 'test/model' });
      const md = fs.readFileSync(getTrailPaths(dir, 'g1-p2-t30').mdPath, 'utf-8');
      expect(md.length).toBeGreaterThan(0);
    });
  });
});
