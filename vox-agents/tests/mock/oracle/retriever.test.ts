/**
 * Tests for the oracle retrieve phase (runRetrieve): CSV parsing/filtering,
 * telemetry DB discovery and open-failure error rows, rationale turn fallback
 * (turn then turn-1), prompt extraction success/error mapping, and the optional
 * retrieved-JSON write path. db-resolver and prompt-extractor are mocked.
 *
 * Assertion-stability rule: assert RetrievedRow fields, error-row mapping, and
 * written JSON structure — never snapshot whole files.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  discoverDbPath: vi.fn(),
  openReadonlyDb: vi.fn(),
  extractPrompt: vi.fn(),
  findTurnByRationale: vi.fn(),
}));

vi.mock('../../../src/oracle/utils/db-resolver.js', () => ({
  discoverDbPath: mocks.discoverDbPath,
  openReadonlyDb: mocks.openReadonlyDb,
}));

vi.mock('../../../src/oracle/utils/prompt-extractor.js', () => ({
  extractPrompt: mocks.extractPrompt,
  findTurnByRationale: mocks.findTurnByRationale,
}));

import { runRetrieve } from '../../../src/oracle/retriever.js';
import type { OracleConfig } from '../../../src/oracle/types.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-retriever-'));
  tempDirs.push(dir);
  return dir;
}

/** Write a CSV file with the given content and return its path. */
function writeCsvFile(dir: string, content: string): string {
  const p = path.join(dir, 'input.csv');
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

/** Standard two-column-plus header CSV used by most tests. */
const CSV_HEADER = 'game_id,player_id,turn,player_type,rationale';

/** A fake Kysely-like db object whose only contract here is destroy(). */
function makeFakeDb(): { destroy: ReturnType<typeof vi.fn> } {
  return { destroy: vi.fn().mockResolvedValue(undefined) };
}

/** Build an ExtractedPrompt-like value for extractPrompt mocks. */
function extracted(overrides: Record<string, any> = {}) {
  return {
    system: ['system prompt'],
    messages: [{ role: 'user', content: 'hi' }],
    activeTools: ['set-flavors'],
    modelString: 'test/model@low',
    agentName: 'simple-strategist',
    ...overrides,
  };
}

function baseConfig(csvPath: string, outputDir: string, overrides: Partial<OracleConfig> = {}): OracleConfig {
  return {
    csvPath,
    experimentName: 'exp',
    outputDir,
    telemetryDir: path.join(outputDir, 'telemetry'),
    agentType: 'strategist',
    modifyPrompt: () => ({}),
    concurrency: 1,
    ...overrides,
  };
}

describe('oracle runRetrieve', () => {
  describe('CSV parsing and filtering', () => {
    it('reads all rows and extracts prompt data per row', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(
        dir,
        `${CSV_HEADER}\ng1,1,30,Test,\ng2,2,40,Test,`
      );
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(makeFakeDb());
      mocks.extractPrompt.mockResolvedValue(extracted());

      const rows = await runRetrieve(baseConfig(csv, dir));

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        originalModel: 'test/model@low',
        agentName: 'simple-strategist',
        agentType: 'strategist',
        system: ['system prompt'],
        activeTools: ['set-flavors'],
      });
      expect(rows[0].row.game_id).toBe('g1');
      expect(rows[1].row.game_id).toBe('g2');
      expect(rows[0].error).toBeUndefined();
    });

    it('applies the config filter to limit processed rows', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(
        dir,
        `${CSV_HEADER}\ng1,1,30,Test,\ng2,2,40,Test,\ng3,3,50,Test,`
      );
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(makeFakeDb());
      mocks.extractPrompt.mockResolvedValue(extracted());

      const rows = await runRetrieve(
        baseConfig(csv, dir, { filter: row => row.game_id === 'g2' })
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].row.game_id).toBe('g2');
      expect(mocks.extractPrompt).toHaveBeenCalledTimes(1);
    });
  });

  describe('DB discovery and open failures', () => {
    it('returns an error row when no DB is discovered', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,`);
      mocks.discoverDbPath.mockReturnValue(null);

      const rows = await runRetrieve(baseConfig(csv, dir));

      expect(rows[0].error).toBe('No telemetry DB found for game=g1, player=1');
      expect(rows[0].system).toEqual([]);
      expect(rows[0].messages).toEqual([]);
      expect(rows[0].activeTools).toEqual([]);
      expect(mocks.openReadonlyDb).not.toHaveBeenCalled();
    });

    it('returns an error row when the DB fails to open', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,`);
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(null);

      const rows = await runRetrieve(baseConfig(csv, dir));

      expect(rows[0].error).toBe('Failed to open telemetry DB: /fake/db.db');
      expect(mocks.extractPrompt).not.toHaveBeenCalled();
    });
  });

  describe('rationale turn fallback', () => {
    it('uses the original turn when the rationale matches there', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,my rationale`);
      const db = makeFakeDb();
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(db);
      mocks.findTurnByRationale.mockResolvedValueOnce(true);
      mocks.extractPrompt.mockResolvedValue(extracted());

      await runRetrieve(baseConfig(csv, dir));

      // Only the turn-30 check runs; no fallback to turn 29.
      expect(mocks.findTurnByRationale).toHaveBeenCalledTimes(1);
      expect(mocks.findTurnByRationale).toHaveBeenCalledWith(db, 30, 'my rationale');
      expect(mocks.extractPrompt).toHaveBeenCalledWith(db, 30, undefined);
    });

    it('falls back to turn-1 when the rationale only matches the previous turn', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,my rationale`);
      const db = makeFakeDb();
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(db);
      mocks.findTurnByRationale
        .mockResolvedValueOnce(false) // turn 30 miss
        .mockResolvedValueOnce(true); // turn 29 hit
      mocks.extractPrompt.mockResolvedValue(extracted());

      await runRetrieve(baseConfig(csv, dir));

      expect(mocks.findTurnByRationale).toHaveBeenNthCalledWith(1, db, 30, 'my rationale');
      expect(mocks.findTurnByRationale).toHaveBeenNthCalledWith(2, db, 29, 'my rationale');
      // Extraction uses the fallback turn.
      expect(mocks.extractPrompt).toHaveBeenCalledWith(db, 29, undefined);
    });

    it('keeps the original turn when neither turn matches the rationale', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,my rationale`);
      const db = makeFakeDb();
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(db);
      mocks.findTurnByRationale.mockResolvedValue(false);
      mocks.extractPrompt.mockResolvedValue(extracted());

      await runRetrieve(baseConfig(csv, dir));

      expect(mocks.findTurnByRationale).toHaveBeenCalledTimes(2);
      expect(mocks.extractPrompt).toHaveBeenCalledWith(db, 30, undefined);
    });

    it('skips rationale matching entirely when the row has no rationale', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,`);
      const db = makeFakeDb();
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(db);
      mocks.extractPrompt.mockResolvedValue(extracted());

      await runRetrieve(baseConfig(csv, dir));

      expect(mocks.findTurnByRationale).not.toHaveBeenCalled();
      expect(mocks.extractPrompt).toHaveBeenCalledWith(db, 30, undefined);
    });

    it('passes the configured targetAgent through to extractPrompt', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,`);
      const db = makeFakeDb();
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(db);
      mocks.extractPrompt.mockResolvedValue(extracted());

      await runRetrieve(baseConfig(csv, dir, { targetAgent: 'simple-strategist' }));

      expect(mocks.extractPrompt).toHaveBeenCalledWith(db, 30, 'simple-strategist');
    });
  });

  describe('prompt extraction mapping', () => {
    it('maps a successful extraction into the RetrievedRow and closes the db', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,`);
      const db = makeFakeDb();
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(db);
      mocks.extractPrompt.mockResolvedValue(
        extracted({ modelString: 'prov/Model@Med', agentName: 'simple-strategist', activeTools: ['t1', 't2'] })
      );

      const rows = await runRetrieve(baseConfig(csv, dir));

      expect(rows[0]).toMatchObject({
        originalModel: 'prov/Model@Med',
        agentName: 'simple-strategist',
        activeTools: ['t1', 't2'],
      });
      expect(rows[0].error).toBeUndefined();
      expect(db.destroy).toHaveBeenCalledTimes(1);
    });

    it('returns an error row when extraction yields no prompt data', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,`);
      const db = makeFakeDb();
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(db);
      mocks.extractPrompt.mockResolvedValue(null);

      const rows = await runRetrieve(baseConfig(csv, dir));

      expect(rows[0].error).toBe('No prompt data found for turn 30 in /fake/db.db');
      // db is still closed via finally.
      expect(db.destroy).toHaveBeenCalledTimes(1);
    });

    it('maps a thrown error into the error field', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,`);
      const db = makeFakeDb();
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(db);
      mocks.extractPrompt.mockRejectedValue(new Error('query exploded'));

      const rows = await runRetrieve(baseConfig(csv, dir));

      expect(rows[0].error).toBe('query exploded');
      expect(db.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('optional retrieved-JSON write path', () => {
    it('does not write any files when save is false (default)', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,`);
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(makeFakeDb());
      mocks.extractPrompt.mockResolvedValue(extracted());

      await runRetrieve(baseConfig(csv, dir));

      expect(fs.existsSync(path.join(dir, 'exp', 'retrieved'))).toBe(false);
    });

    it('writes a retrieved JSON per successful row when save is true', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,`);
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(makeFakeDb());
      mocks.extractPrompt.mockResolvedValue(extracted({ modelString: 'prov/Model@Med' }));

      await runRetrieve(baseConfig(csv, dir), true);

      const written = path.join(dir, 'exp', 'retrieved', 'g1-p1-t30.json');
      expect(fs.existsSync(written)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(written, 'utf-8'));
      expect(parsed.originalModel).toBe('prov/Model@Med');
      expect(parsed.row.game_id).toBe('g1');
    });

    it('does not write a JSON file for an error row even when save is true', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,`);
      mocks.discoverDbPath.mockReturnValue(null);

      await runRetrieve(baseConfig(csv, dir), true);

      expect(fs.existsSync(path.join(dir, 'exp', 'retrieved', 'g1-p1-t30.json'))).toBe(false);
    });

    it('uses retrievalName for the output directory when provided', async () => {
      const dir = makeTempDir();
      const csv = writeCsvFile(dir, `${CSV_HEADER}\ng1,1,30,Test,`);
      mocks.discoverDbPath.mockReturnValue('/fake/db.db');
      mocks.openReadonlyDb.mockReturnValue(makeFakeDb());
      mocks.extractPrompt.mockResolvedValue(extracted());

      await runRetrieve(baseConfig(csv, dir, { retrievalName: 'shared' }), true);

      expect(fs.existsSync(path.join(dir, 'shared', 'retrieved', 'g1-p1-t30.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'exp', 'retrieved', 'g1-p1-t30.json'))).toBe(false);
    });
  });
});
