/**
 * Mock-tier unit tests for src/oracle/replayer.ts (runReplay).
 *
 * Scope: the non-cache replay paths. Schema-cache behavior lives in
 * replayer-cache.test.ts and schema-only field stripping lives in
 * schema-tools.test.ts; this file stays disjoint from both. Covers:
 * model-override expansion (incl. duplicate-model repetitions), the configured
 * concurrency cap, modifyPrompt merge behavior, extractColumns context,
 * per-row error mapping, and CSV/trail writes. System/message arrays are opaque
 * placeholders; assertions cover structural facts only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Papa from 'papaparse';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OracleConfig, RetrievedRow } from '../../../src/oracle/types.js';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  createContext: vi.fn(),
  disconnect: vi.fn(),
  execute: vi.fn(),
  forceFlush: vi.fn(),
  loadToolSchemaCache: vi.fn(() => true),
  registerTools: vi.fn(),
  replaceToolsWithSchemaOnly: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock('../../../src/infra/vox-context.js', () => ({
  VoxContext: vi.fn().mockImplementation(() => ({
    execute: mocks.execute,
    registerTools: mocks.registerTools,
    shutdown: mocks.shutdown,
    tools: {},
  })),
}));

vi.mock('../../../src/oracle/utils/schema-tools.js', () => ({
  loadToolSchemaCache: mocks.loadToolSchemaCache,
  replaceToolsWithSchemaOnly: mocks.replaceToolsWithSchemaOnly,
}));

vi.mock('../../../src/utils/models/mcp-client.js', () => ({
  mcpClient: {
    connect: mocks.connect,
    disconnect: mocks.disconnect,
  },
}));

vi.mock('../../../src/utils/telemetry/vox-exporter.js', () => ({
  VoxSpanExporter: {
    getInstance: () => ({
      createContext: mocks.createContext,
    }),
  },
}));

vi.mock('../../../src/instrumentation.js', () => ({
  spanProcessor: {
    forceFlush: mocks.forceFlush,
  },
}));

import { runReplay } from '../../../src/oracle/replayer.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseRow = {
  game_id: 'game-1',
  player_id: '2',
  turn: '3',
  player_type: 'Test',
  rationale: 'original rationale',
};

function retrieved(overrides: Partial<RetrievedRow> = {}): RetrievedRow {
  return {
    row: baseRow,
    originalModel: 'oracle-test/original-model@low',
    agentName: 'simple-strategist',
    system: ['SYSTEM_PLACEHOLDER'],
    messages: [{ role: 'user', content: 'USER_PLACEHOLDER' }],
    activeTools: ['set-flavors'],
    ...overrides,
  };
}

function baseConfig(
  outputDir: string,
  experimentName: string,
  modifyPrompt: OracleConfig['modifyPrompt'],
  extra: Partial<OracleConfig> = {}
): OracleConfig {
  return {
    csvPath: 'unused.csv',
    experimentName,
    outputDir,
    modifyPrompt,
    concurrency: 1,
    ...extra,
  };
}

/** Default execute mock: echoes input.row, reports stable tokens, one decision. */
function mockFreshExecution(): void {
  mocks.execute.mockImplementation(async (_agentName, parameters, input, _callback, tokenOutput) => {
    tokenOutput.inputTokens = 10;
    tokenOutput.reasoningTokens = 20;
    tokenOutput.outputTokens = 30;
    return {
      row: input.row,
      model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
      decisions: [{ toolName: 'set-flavors', args: { GrandStrategy: 'Conquest' }, rationale: 'fresh rationale' }],
      tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
      messages: [{ role: 'assistant', content: 'RESPONSE_PLACEHOLDER' }],
    };
  });
}

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-replay-'));
  tempDirs.push(dir);
  return dir;
}

function readCsvRows(outputDir: string, experimentName: string): Record<string, string>[] {
  const csv = fs.readFileSync(path.join(outputDir, `${experimentName}-results.csv`), 'utf-8');
  return Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('oracle replayer (non-cache paths)', () => {
  describe('model-override expansion', () => {
    it('runs once with the original model when modelOverride is absent', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();

      const results = await runReplay(
        baseConfig(outputDir, 'no-override', () => ({})),
        [retrieved()]
      );

      expect(results).toHaveLength(1);
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(results[0].repetition).toBeUndefined();
      // Resolved from the original model string.
      expect(results[0].model).toBe('oracle-test/original-model');
    });

    it('expands one source row into one task per distinct override model', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();

      const results = await runReplay(
        baseConfig(outputDir, 'multi-distinct', () => ({}), {
          modelOverride: () => ['oracle-test/model-a@low', 'oracle-test/model-b@high'],
        }),
        [retrieved()]
      );

      expect(results).toHaveLength(2);
      expect(mocks.execute).toHaveBeenCalledTimes(2);
      const models = results.map(r => r.model).sort();
      expect(models).toEqual(['oracle-test/model-a', 'oracle-test/model-b']);
      // Distinct models carry no repetition index.
      expect(results.every(r => r.repetition === undefined)).toBe(true);
    });

    it('assigns 1-based repetition indexes when the same model repeats', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();

      const results = await runReplay(
        baseConfig(outputDir, 'dup-model', () => ({}), {
          modelOverride: () => ['oracle-test/dup@low', 'oracle-test/dup@low', 'oracle-test/dup@low'],
        }),
        [retrieved()]
      );

      expect(results).toHaveLength(3);
      const reps = results.map(r => r.repetition).sort();
      expect(reps).toEqual([1, 2, 3]);
      // Three distinct trail files were written (suffixed by repetition).
      const trailFiles = fs
        .readdirSync(path.join(outputDir, 'dup-model'))
        .filter(f => f.endsWith('.json'))
        .sort();
      expect(trailFiles).toEqual([
        'game-1-p2-t3-dup-1.json',
        'game-1-p2-t3-dup-2.json',
        'game-1-p2-t3-dup-3.json',
      ]);
    });

    it('treats a single-element override array as a single un-suffixed task', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();

      const results = await runReplay(
        baseConfig(outputDir, 'single-array', () => ({}), {
          modelOverride: () => ['oracle-test/solo@low'],
        }),
        [retrieved()]
      );

      expect(results).toHaveLength(1);
      expect(results[0].repetition).toBeUndefined();
      expect(results[0].model).toBe('oracle-test/solo');
      const trailFiles = fs.readdirSync(path.join(outputDir, 'single-array')).filter(f => f.endsWith('.json'));
      expect(trailFiles).toEqual(['game-1-p2-t3.json']);
    });
  });

  describe('concurrency cap', () => {
    it('never exceeds the configured concurrency limit', async () => {
      const outputDir = makeTempDir();
      const concurrency = 2;
      let active = 0;
      let maxActive = 0;
      mocks.execute.mockImplementation(async (_agentName, parameters, input, _cb, tokenOutput) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 15));
        active--;
        tokenOutput.inputTokens = 1;
        return {
          row: input.row,
          model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
          decisions: [],
          tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
          messages: [],
        };
      });

      // 6 tasks via a 6-element distinct-model override on one row.
      const results = await runReplay(
        baseConfig(outputDir, 'concurrency', () => ({}), {
          concurrency,
          modelOverride: () => [
            'oracle-test/c1@low',
            'oracle-test/c2@low',
            'oracle-test/c3@low',
            'oracle-test/c4@low',
            'oracle-test/c5@low',
            'oracle-test/c6@low',
          ],
        }),
        [retrieved()]
      );

      expect(results).toHaveLength(6);
      expect(maxActive).toBeLessThanOrEqual(concurrency);
      expect(maxActive).toBeGreaterThan(1);
    });
  });

  describe('modifyPrompt merge behavior', () => {
    it('passes original prompt context into modifyPrompt and merges overrides', async () => {
      const outputDir = makeTempDir();
      const captured: any[] = [];
      mocks.execute.mockImplementation(async (_agentName, parameters, input, _cb, tokenOutput) => {
        captured.push({ parameters, input });
        tokenOutput.inputTokens = 5;
        return {
          row: input.row,
          model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
          decisions: [],
          tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
          messages: [],
        };
      });

      const modifyPrompt = vi.fn((ctx) => {
        // Receives the original (unmodified) retrieved prompt context.
        expect(ctx.system).toEqual(['SYSTEM_PLACEHOLDER']);
        expect(ctx.activeTools).toEqual(['set-flavors']);
        expect(ctx.agentName).toBe('simple-strategist');
        return {
          system: ['OVERRIDDEN_SYSTEM'],
          activeTools: ['set-strategy', 'keep-status-quo'],
          metadata: { tag: 'merged' },
        };
      });

      await runReplay(baseConfig(outputDir, 'merge', modifyPrompt), [retrieved()]);

      expect(modifyPrompt).toHaveBeenCalledTimes(1);
      // system + activeTools overridden; messages fell back to the original.
      expect(captured[0].input.system).toEqual(['OVERRIDDEN_SYSTEM']);
      expect(captured[0].input.messages).toEqual([{ role: 'user', content: 'USER_PLACEHOLDER' }]);
      expect(captured[0].parameters.activeTools).toEqual(['set-strategy', 'keep-status-quo']);
      expect(captured[0].input.metadata).toEqual({ tag: 'merged' });

      // Trail records which fields were modified.
      const trail = JSON.parse(
        fs.readFileSync(path.join(outputDir, 'merge', 'game-1-p2-t3.json'), 'utf-8')
      );
      expect(trail.modifications).toMatchObject({
        systemModified: true,
        messagesModified: false,
        activeToolsModified: true,
        metadata: { tag: 'merged' },
      });
    });

    it('keeps all originals when modifyPrompt returns an empty object', async () => {
      const outputDir = makeTempDir();
      const captured: any[] = [];
      mocks.execute.mockImplementation(async (_agentName, parameters, input, _cb, tokenOutput) => {
        captured.push(input);
        tokenOutput.inputTokens = 1;
        return {
          row: input.row,
          model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
          decisions: [],
          tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
          messages: [],
        };
      });

      await runReplay(baseConfig(outputDir, 'no-merge', () => ({})), [retrieved()]);

      expect(captured[0].system).toEqual(['SYSTEM_PLACEHOLDER']);
      expect(captured[0].messages).toEqual([{ role: 'user', content: 'USER_PLACEHOLDER' }]);
      const trail = JSON.parse(
        fs.readFileSync(path.join(outputDir, 'no-merge', 'game-1-p2-t3.json'), 'utf-8')
      );
      expect(trail.modifications).toMatchObject({
        systemModified: false,
        messagesModified: false,
        activeToolsModified: false,
      });
    });
  });

  describe('extractColumns context', () => {
    it('invokes extractColumns with replay context and writes columns to CSV + result', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();
      let seenCtx: any;

      const extractColumns = vi.fn((ctx) => {
        seenCtx = ctx;
        return { replay_score: 42, decision_count: ctx.decisions.length };
      });

      const results = await runReplay(
        baseConfig(outputDir, 'extract', () => ({ system: ['MODIFIED'] }), { extractColumns }),
        [retrieved()]
      );

      expect(extractColumns).toHaveBeenCalledTimes(1);
      expect(seenCtx.originalPrompts).toEqual(['SYSTEM_PLACEHOLDER']);
      expect(seenCtx.replayPrompts).toEqual(['MODIFIED']);
      expect(seenCtx.agentName).toBe('simple-strategist');
      expect(seenCtx.row).toEqual(baseRow);
      expect(seenCtx.decisions).toHaveLength(1);

      expect(results[0].extractedColumns).toEqual({ replay_score: 42, decision_count: 1 });

      const csvRows = readCsvRows(outputDir, 'extract');
      expect(csvRows[0].replay_score).toBe('42');
      expect(csvRows[0].decision_count).toBe('1');
    });
  });

  describe('per-row error mapping', () => {
    it('skips rows that already carry an extraction error', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();

      const results = await runReplay(
        baseConfig(outputDir, 'skip-error', () => ({})),
        [retrieved({ error: 'extraction failed' })]
      );

      expect(results).toHaveLength(0);
      expect(mocks.execute).not.toHaveBeenCalled();
    });

    it('maps a thrown execution error into an error ReplayResult and continues', async () => {
      const outputDir = makeTempDir();
      mocks.execute.mockImplementation(async (_agentName, parameters, input, _cb, tokenOutput) => {
        if (parameters.resolvedModel.name === 'boom') {
          throw new Error('model exploded');
        }
        tokenOutput.inputTokens = 7;
        return {
          row: input.row,
          model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
          decisions: [],
          tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
          messages: [],
        };
      });

      const results = await runReplay(
        baseConfig(outputDir, 'exec-error', () => ({}), {
          modelOverride: () => ['oracle-test/boom@low', 'oracle-test/ok@low'],
        }),
        [retrieved()]
      );

      expect(results).toHaveLength(2);
      const failed = results.find(r => r.error);
      const ok = results.find(r => !r.error);
      expect(failed).toBeDefined();
      expect(failed!.error).toBe('model exploded');
      expect(failed!.model).toBe('oracle-test/boom');
      expect(failed!.decisions).toEqual([]);
      expect(failed!.tokens).toEqual({ inputTokens: 0, reasoningTokens: 0, outputTokens: 0 });
      expect(ok!.model).toBe('oracle-test/ok');

      // Error surfaces in CSV.
      const csvRows = readCsvRows(outputDir, 'exec-error');
      const errorRow = csvRows.find(r => r.error === 'model exploded');
      expect(errorRow).toBeDefined();
    });

    it('maps a null oracle result into an error ReplayResult', async () => {
      const outputDir = makeTempDir();
      mocks.execute.mockImplementation(async () => undefined);

      const results = await runReplay(
        baseConfig(outputDir, 'null-result', () => ({})),
        [retrieved()]
      );

      expect(results).toHaveLength(1);
      expect(results[0].error).toBe('Oracle agent returned no result');
    });
  });

  describe('CSV and trail writes', () => {
    it('writes a results CSV and per-task trail files for every task', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();

      await runReplay(
        baseConfig(outputDir, 'outputs', () => ({})),
        [retrieved()]
      );

      // Results CSV at the output-dir root.
      expect(fs.existsSync(path.join(outputDir, 'outputs-results.csv'))).toBe(true);

      // Trail JSON + markdown in the experiment dir.
      const expDir = path.join(outputDir, 'outputs');
      expect(fs.existsSync(path.join(expDir, 'game-1-p2-t3.json'))).toBe(true);
      expect(fs.existsSync(path.join(expDir, 'game-1-p2-t3.md'))).toBe(true);

      const csvRows = readCsvRows(outputDir, 'outputs');
      expect(csvRows).toHaveLength(1);
      // writeCsv renames row.rationale -> originalRationale and adds token columns.
      expect(csvRows[0].originalRationale).toBe('original rationale');
      expect(csvRows[0].replayRationale).toBe('fresh rationale');
      expect(csvRows[0].input_tokens).toBe('10');
      expect(csvRows[0].output_tokens).toBe('30');
      expect(csvRows[0].model).toBe('oracle-test/original-model');
    });

    it('flushes telemetry and shuts down the context exactly once', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();

      await runReplay(baseConfig(outputDir, 'lifecycle', () => ({})), [retrieved()]);

      expect(mocks.forceFlush).toHaveBeenCalledTimes(1);
      expect(mocks.createContext).toHaveBeenCalledTimes(1);
      expect(mocks.shutdown).toHaveBeenCalledTimes(1);
      // Cached schemas loaded -> never touches MCP connect/disconnect.
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(mocks.disconnect).not.toHaveBeenCalled();
    });
  });
});
