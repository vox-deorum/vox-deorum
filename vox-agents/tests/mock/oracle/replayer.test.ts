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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OracleConfig, RetrievedRow } from '../../../src/oracle/types.js';

const mocks = vi.hoisted(() => {
  // Holds the parameters of the run currently being opened. execute() no longer receives a
  // parameters argument (Stage 5), so the execute mock (which stands in for the oracle agent)
  // reads the active run's parameters from here. Each mock captures it into a local const as its
  // first synchronous statement, before any await, so concurrent tasks never read each other's.
  const runState: { parameters: any } = { parameters: undefined };
  // Stands in for the process manager's shutdown flag. runReplay reads it per call rather than
  // capturing it at import, so flipping this mid-run is enough to simulate Ctrl+C.
  const shuttingDown = { value: false };
  return {
    connect: vi.fn(),
    shuttingDown,
    createContext: vi.fn(),
    disconnect: vi.fn(),
    execute: vi.fn(),
    runState,
    // Each replay task opens its own root via withRun({ parameters }); the fake captures the run's
    // parameters, runs the callback (which calls execute), and returns its result.
    withRun: vi.fn(async (options: any, cb: (run: unknown) => unknown) => {
      runState.parameters = options?.parameters;
      return cb({
        id: 'oracle-run',
        parameters: options?.parameters ?? {},
        signal: new AbortController().signal,
        tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
        abort: () => {},
      });
    }),
    forceFlush: vi.fn(),
    loadToolSchemaCache: vi.fn(() => true),
    registerTools: vi.fn(),
    replaceToolsWithSchemaOnly: vi.fn(),
    shutdown: vi.fn(),
    shutdownBatchManager: vi.fn(),
    startBatchManager: vi.fn(),
  };
});

vi.mock('../../../src/infra/vox-context.js', () => ({
  VoxContext: vi.fn().mockImplementation(() => ({
    execute: mocks.execute,
    withRun: mocks.withRun,
    registerTools: mocks.registerTools,
    shutdown: mocks.shutdown,
    tools: {},
  })),
}));

vi.mock('../../../src/infra/process-manager.js', () => ({
  processManager: {
    get isShuttingDown() { return mocks.shuttingDown.value; },
    register: vi.fn(),
  },
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

vi.mock('../../../src/oracle/batch/batch-manager.js', () => ({
  shutdownBatchManager: mocks.shutdownBatchManager,
  startBatchManager: mocks.startBatchManager,
}));

import { loadRetrievedRows, runReplay } from '../../../src/oracle/replayer.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import type { OracleAgent } from '../../../src/oracle/oracle-agent.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  mocks.shuttingDown.value = false;
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
    files: false,
    prompts: false,
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
  mocks.execute.mockImplementation(async (_agentName, input, _callback, tokenOutput) => {
    const parameters = mocks.runState.parameters;
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
  describe('loadRetrievedRows', () => {
    it('should default the workspace fields of rows saved before they existed and keep recorded ones', () => {
      const dir = makeTempDir();
      const { files: _files, prompts: _prompts, ...older } = retrieved();
      const recorded = retrieved({ files: { game: 'write', shared: {}, quota: 20 }, workspace: 7, prompts: 'custom-prompts' });
      fs.writeFileSync(path.join(dir, 'a-older.json'), JSON.stringify(older));
      fs.writeFileSync(path.join(dir, 'b-recorded.json'), JSON.stringify(recorded));

      const rows = loadRetrievedRows(dir);

      expect(rows).toEqual([{ ...older, files: false, prompts: false }, recorded]);
    });
  });

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

    it('passes the original turn framing into modelOverride as its third argument', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();
      const seen: Array<{ originalModel: string; original: unknown }> = [];

      const modelOverride = vi.fn((originalModel: string, _row: any, original: unknown) => {
        seen.push({ originalModel, original });
        return undefined; // keep the original model
      });

      await runReplay(
        baseConfig(outputDir, 'override-framing-arg', () => ({}), { modelOverride }),
        [retrieved({ framing: 'action' })]
      );

      expect(modelOverride).toHaveBeenCalledTimes(1);
      expect(seen[0].originalModel).toBe('oracle-test/original-model@low');
      expect(seen[0].original).toEqual({ framing: 'action' });
    });

    it('reproduces source framing when modelOverride returns a model with options.framing', async () => {
      const outputDir = makeTempDir();
      const captured: any[] = [];
      mocks.execute.mockImplementation(async (_agentName, input, _cb, tokenOutput) => {
        const parameters = mocks.runState.parameters;
        captured.push(parameters.resolvedModel);
        tokenOutput.inputTokens = 1;
        return {
          row: input.row,
          model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
          decisions: [],
          tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
          messages: [],
        };
      });

      // Two source rows with identical models but different framings resolve to the
      // same name yet carry distinct options.framing — the opt-in P2#1 documents.
      const modelOverride = (_m: string, _row: any, original?: { framing?: string }) =>
        original?.framing
          ? { provider: 'oracle-test', name: 'reframed', options: { framing: original.framing } }
          : { provider: 'oracle-test', name: 'reframed' };

      await runReplay(
        baseConfig(outputDir, 'reproduce-framing', () => ({}), { modelOverride: modelOverride as any }),
        [
          retrieved({ framing: 'action', row: { ...baseRow, turn: '3' } }),
          retrieved({ framing: 'tool', row: { ...baseRow, turn: '4' } }),
        ]
      );

      const framings = captured.map(m => m.options?.framing);
      expect(framings).toContain('action');
      expect(framings).toContain('tool');
    });
  });

  describe('concurrency cap', () => {
    it('never exceeds the configured concurrency limit', async () => {
      const outputDir = makeTempDir();
      const concurrency = 2;
      let active = 0;
      let maxActive = 0;
      mocks.execute.mockImplementation(async (_agentName, input, _cb, tokenOutput) => {
        const parameters = mocks.runState.parameters;
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

  describe('repeated prompt caching', () => {
    const claude = { provider: 'anthropic', name: 'claude-test' } as any;
    const other = { provider: 'oracle-test', name: 'other-test' } as any;

    /** Records each execution's start and end, plus whether it asked for prompt caching. */
    function mockLoggedExecution(log: string[], cacheFlags: (boolean | undefined)[], fail = false): void {
      mocks.execute.mockImplementation(async (_agentName, input) => {
        const parameters = mocks.runState.parameters;
        cacheFlags.push(parameters.cachePrompt);
        log.push('start');
        await new Promise(resolve => setTimeout(resolve, 10));
        log.push('end');
        if (fail && log.length === 2) throw new Error('first repetition failed');
        return {
          row: input.row,
          model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
          decisions: [],
          tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
          messages: [],
        };
      });
    }

    it('should cache the prompt and start later Claude repetitions only after the first is done', async () => {
      const log: string[] = [];
      const cacheFlags: (boolean | undefined)[] = [];
      mockLoggedExecution(log, cacheFlags);

      const results = await runReplay(
        baseConfig(makeTempDir(), 'claude-reps', () => ({}), { concurrency: 3, modelOverride: () => [claude, claude, claude] }),
        [retrieved()]
      );

      expect(results).toHaveLength(3);
      expect(log.slice(0, 2)).toEqual(['start', 'end']);
      expect(cacheFlags).toEqual([true, true, true]);
    });

    it('should still run later repetitions when the first one fails', async () => {
      const log: string[] = [];
      mockLoggedExecution(log, [], true);

      const results = await runReplay(
        baseConfig(makeTempDir(), 'claude-reps-fail', () => ({}), { concurrency: 3, modelOverride: () => [claude, claude] }),
        [retrieved()]
      );

      expect(results.filter(r => r.error)).toHaveLength(1);
      expect(results.filter(r => !r.error)).toHaveLength(1);
    });

    it('should leave single replays and non-Claude repetitions uncached and concurrent', async () => {
      const log: string[] = [];
      const cacheFlags: (boolean | undefined)[] = [];
      mockLoggedExecution(log, cacheFlags);

      await runReplay(
        baseConfig(makeTempDir(), 'other-reps', () => ({}), { concurrency: 3, modelOverride: () => [other, other, claude] }),
        [retrieved()]
      );

      expect(log.slice(0, 3)).toEqual(['start', 'start', 'start']);
      expect(cacheFlags.every(flag => !flag)).toBe(true);
    });
  });

  describe('modifyPrompt merge behavior', () => {
    it('passes original prompt context into modifyPrompt and merges overrides', async () => {
      const outputDir = makeTempDir();
      const captured: any[] = [];
      mocks.execute.mockImplementation(async (_agentName, input, _cb, tokenOutput) => {
        const parameters = mocks.runState.parameters;
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
      mocks.execute.mockImplementation(async (_agentName, input, _cb, tokenOutput) => {
        const parameters = mocks.runState.parameters;
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
      mocks.execute.mockImplementation(async (_agentName, input, _cb, tokenOutput) => {
        const parameters = mocks.runState.parameters;
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
      // Each replay task ran inside its own root: one withRun per task, each carrying the
      // task's OracleParameters as the run's parameter source.
      expect(mocks.withRun).toHaveBeenCalledTimes(1);
      expect(mocks.withRun.mock.calls[0][0]).toEqual({ parameters: expect.objectContaining({ turn: 3 }) });
      // Cached schemas loaded -> never touches MCP connect/disconnect.
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(mocks.disconnect).not.toHaveBeenCalled();
    });

    it('flushes telemetry before teardown when replay setup throws', async () => {
      const outputDir = makeTempDir();
      mocks.createContext.mockRejectedValueOnce(new Error('telemetry context failed'));

      await expect(runReplay(baseConfig(outputDir, 'lifecycle-error', () => ({})), [retrieved()]))
        .rejects.toThrow('telemetry context failed');

      expect(mocks.forceFlush).toHaveBeenCalledTimes(1);
      expect(mocks.shutdown).toHaveBeenCalledTimes(1);
    });
  });

  describe('retrieved input validation', () => {
    it('throws when replay input is absent instead of terminating the process', async () => {
      const outputDir = makeTempDir();

      await expect(runReplay(baseConfig(outputDir, 'missing-retrieved', () => ({}))))
        .rejects.toThrow('No retrieved rows found');
    });
  });

  describe('shutdown (Ctrl+C) and graceful stop (Ctrl+A)', () => {
    /** Four distinct models expand one source row into four tasks, run one at a time. */
    const FOUR_MODELS = ['oracle-test/m-a@low', 'oracle-test/m-b@low', 'oracle-test/m-c@low', 'oracle-test/m-d@low'];

    /** Execute mock whose single task stays pending until the returned resolver is called. */
    function mockPendingFirstTask(): Promise<(result?: any) => void> {
      return new Promise<(result?: any) => void>(exposeResolver => {
        mocks.execute.mockImplementationOnce(async (_agentName, input, _callback, tokenOutput) => {
          tokenOutput.inputTokens = 10;
          return new Promise(settle => {
            exposeResolver((result = {}) => settle({
              row: input.row,
              model: 'oracle-test/m-a',
              decisions: [],
              tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
              messages: [],
              ...result,
            }));
          });
        });
      });
    }

    /** Execute mock that raises the shutdown flag while the first task is running. */
    function mockShutdownDuringFirstTask(): void {
      mocks.execute.mockImplementation(async (_agentName, input, _callback, tokenOutput) => {
        const parameters = mocks.runState.parameters;
        mocks.shuttingDown.value = true;
        tokenOutput.inputTokens = 10;
        return {
          row: input.row,
          model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
          decisions: [],
          tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
          messages: [],
        };
      });
    }

    it('drops queued tasks instead of dispatching them once shutdown starts', async () => {
      const outputDir = makeTempDir();
      mockShutdownDuringFirstTask();

      const results = await runReplay(
        baseConfig(outputDir, 'interrupt-queue', () => ({}), { modelOverride: () => FOUR_MODELS }),
        [retrieved()]
      );

      // Every task still settles (Promise.all must not hang), but only the first one ran.
      expect(results).toHaveLength(FOUR_MODELS.length);
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      const interrupted = results.filter(r => r.error === 'Interrupted by shutdown');
      expect(interrupted).toHaveLength(FOUR_MODELS.length - 1);
      // Dropped tasks are marked interrupted, never reported as replay failures.
      expect(results.some(r => r.error && r.error !== 'Interrupted by shutdown')).toBe(false);
    });

    it('leaves an existing results CSV untouched when interrupted', async () => {
      const outputDir = makeTempDir();
      const csvPath = path.join(outputDir, 'interrupt-csv-results.csv');
      fs.writeFileSync(csvPath, 'PREVIOUS_COMPLETE_RUN', 'utf-8');
      mockShutdownDuringFirstTask();

      await runReplay(
        baseConfig(outputDir, 'interrupt-csv', () => ({}), { modelOverride: () => FOUR_MODELS }),
        [retrieved()]
      );

      expect(fs.readFileSync(csvPath, 'utf-8')).toBe('PREVIOUS_COMPLETE_RUN');
      // The completed task's trail still landed, so the next run can reuse it as cache.
      const trails = fs.readdirSync(path.join(outputDir, 'interrupt-csv')).filter(f => f.endsWith('.json'));
      expect(trails).toEqual(['game-1-p2-t3-m-a.json']);
      expect(mocks.forceFlush).toHaveBeenCalledTimes(1);
    });

    it('drains active work without publishing a CSV after a graceful stop', async () => {
      const outputDir = makeTempDir();
      const csvPath = path.join(outputDir, 'graceful-csv-results.csv');
      fs.writeFileSync(csvPath, 'PREVIOUS_COMPLETE_RUN', 'utf-8');
      const execution = mockPendingFirstTask();
      const stop = { value: false };
      const results = runReplay(
        baseConfig(outputDir, 'graceful-csv', () => ({}), { modelOverride: () => FOUR_MODELS }),
        [retrieved()],
        () => stop.value
      );

      await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
      stop.value = true;
      (await execution)();

      await expect(results).resolves.toHaveLength(1);
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(csvPath, 'utf-8')).toBe('PREVIOUS_COMPLETE_RUN');
      expect(fs.readdirSync(path.join(outputDir, 'graceful-csv')).filter(f => f.endsWith('.json')))
        .toEqual(['game-1-p2-t3-m-a.json']);
      expect(mocks.forceFlush).toHaveBeenCalledTimes(1);
    });

    it('publishes the CSV when a graceful stop arrives after every task was admitted', async () => {
      const outputDir = makeTempDir();
      const execution = mockPendingFirstTask();
      const stop = { value: false };
      // One row, one model: the single task is admitted before the stop, so nothing is withheld
      // and the run is complete despite the pending stop.
      const results = runReplay(
        baseConfig(outputDir, 'graceful-complete', () => ({})),
        [retrieved()],
        () => stop.value
      );

      await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
      stop.value = true;
      (await execution)();

      await expect(results).resolves.toHaveLength(1);
      expect(readCsvRows(outputDir, 'graceful-complete')).toHaveLength(1);
    });

    it('finishes admitted batch work and still shuts the batch manager down after a graceful stop', async () => {
      const outputDir = makeTempDir();
      const execution = mockPendingFirstTask();
      const stop = { value: false };

      const results = runReplay(
        baseConfig(outputDir, 'batch-stop', () => ({}), { batch: true, modelOverride: () => FOUR_MODELS }),
        [retrieved()],
        () => stop.value
      );

      await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
      stop.value = true;
      expect(mocks.shutdownBatchManager).not.toHaveBeenCalled();
      (await execution)();

      // The admitted task keeps running past the stop and lands its trail; only the queued
      // tasks are withheld, and the batch manager is torn down exactly once afterwards.
      await expect(results).resolves.toHaveLength(1);
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(fs.readdirSync(path.join(outputDir, 'batch-stop')).filter(f => f.endsWith('.json')))
        .toEqual(['game-1-p2-t3-m-a.json']);
      expect(mocks.startBatchManager).toHaveBeenCalledTimes(1);
      expect(mocks.shutdownBatchManager).toHaveBeenCalledTimes(1);
    });
  });

  describe('tool policy', () => {
    // The registered agent is a process-wide singleton that runReplay configures in place, so each
    // case restores the declared defaults rather than leaking a policy into the next test.
    const agent = () => agentRegistry.get('oracle') as unknown as OracleAgent;
    let defaults: { toolChoice: string; completionTools: string[] };

    beforeEach(() => {
      defaults = { toolChoice: agent().toolChoice, completionTools: agent().completionTools };
    });

    afterEach(() => {
      agent().toolChoice = defaults.toolChoice;
      agent().completionTools = defaults.completionTools;
    });

    it('keeps the declared defaults when the config sets no tool policy', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();

      await runReplay(baseConfig(outputDir, 'policy-default', () => ({})), [retrieved()]);

      expect(agent().toolChoice).toBe('auto');
      expect(agent().completionTools).toEqual(['set-strategy', 'set-flavors', 'keep-status-quo']);
    });

    it('applies the config tool choice and completion tools to the registered agent', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();

      await runReplay(
        baseConfig(outputDir, 'policy-required', () => ({}), {
          toolChoice: 'required',
          completionTools: ['set-flavors', 'keep-status-quo'],
        }),
        [retrieved()]
      );

      expect(agent().toolChoice).toBe('required');
      expect(agent().completionTools).toEqual(['set-flavors', 'keep-status-quo']);
    });

    it('overrides each setting independently', async () => {
      const outputDir = makeTempDir();
      mockFreshExecution();

      await runReplay(
        baseConfig(outputDir, 'policy-choice-only', () => ({}), { toolChoice: 'required' }),
        [retrieved()]
      );

      expect(agent().toolChoice).toBe('required');
      // completionTools was omitted, so the declared default survives.
      expect(agent().completionTools).toEqual(['set-strategy', 'set-flavors', 'keep-status-quo']);
    });
  });
});
