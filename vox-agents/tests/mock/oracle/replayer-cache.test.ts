/**
 * Tests for Oracle replay cache loading and the queue behavior around cached samples.
 *
 * The cache is read once before scheduling. Hits become settled results without entering a
 * chain, so these cases cover prefixes, holes, all-cached runs, malformed trails, and stops.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Papa from 'papaparse';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OracleConfig, RetrievedRow } from '../../../src/oracle/types.js';
import { deferred } from '../../helpers/deferred.js';

const mocks = vi.hoisted(() => {
  // Each replay task opens its own root via withRun({ parameters }); the fake captures the
  // parameters so execute can report the model the task resolved to.
  const runState: { parameters: any } = { parameters: undefined };
  return {
    connect: vi.fn(),
    runState,
    createContext: vi.fn(),
    disconnect: vi.fn(),
    execute: vi.fn(),
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
    loadToolCache: vi.fn(() => true),
    registerTools: vi.fn(),
    replaceToolsWithSchemaOnly: vi.fn(),
    shutdown: vi.fn(),
  };
});

vi.mock('../../../src/infra/vox-context.js', () => ({
  VoxContext: vi.fn().mockImplementation(() => ({
    execute: mocks.execute,
    withRun: mocks.withRun,
    registerTools: mocks.registerTools,
    loadToolCache: mocks.loadToolCache,
    shutdown: mocks.shutdown,
    tools: {},
  })),
}));

vi.mock('../../../src/oracle/utils/schema-tools.js', () => ({
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
import { getTrailBase, writeTrail } from '../../../src/oracle/utils/output.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('oracle replay cache', () => {
  it('uses an existing trail JSON instead of executing the oracle agent', async () => {
    const outputDir = makeTempDir();
    const experimentDir = path.join(outputDir, 'cache-hit');
    writeCachedTrail(experimentDir, baseRow, '');
    const modifyPrompt = vi.fn(() => ({}));

    const results = await runReplay(baseConfig(outputDir, 'cache-hit', modifyPrompt), [baseRetrieved]);

    expect(mocks.execute).not.toHaveBeenCalled();
    expect(modifyPrompt).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      model: 'test/cached-model',
      decisions: [{ rationale: 'cached rationale' }],
      tokens: { inputTokens: 11, reasoningTokens: 22, outputTokens: 33 },
    });
    expect(fs.existsSync(path.join(outputDir, 'cache-hit-results.csv'))).toBe(true);
  });

  it('accepts a cached error result as a normal cache hit', async () => {
    const outputDir = makeTempDir();
    const experimentDir = path.join(outputDir, 'cache-error');
    writeCachedTrail(experimentDir, baseRow, '', 'test/cached-model', 'cached failure');

    const results = await runReplay(baseConfig(outputDir, 'cache-error', () => ({})), [baseRetrieved]);

    expect(mocks.execute).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].error).toBe('cached failure');
    expect(readCsvRows(outputDir, 'cache-error')[0].error).toBe('cached failure');
  });

  it('falls back to execution when an existing cache file is malformed', async () => {
    const outputDir = makeTempDir();
    const experimentDir = path.join(outputDir, 'malformed-cache');
    fs.mkdirSync(experimentDir, { recursive: true });
    fs.writeFileSync(path.join(experimentDir, `${getTrailBase(baseRow, '')}.json`), '{not valid json');
    const modifyPrompt = vi.fn(() => ({}));
    mockFreshExecution();

    const results = await runReplay(baseConfig(outputDir, 'malformed-cache', modifyPrompt), [baseRetrieved]);

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(modifyPrompt).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({
      model: 'test/fresh-model',
      decisions: [{ rationale: 'fresh rationale' }],
      tokens: { inputTokens: 101, reasoningTokens: 202, outputTokens: 303 },
    });
  });

  it('ignores existing trail JSON when readCache is false', async () => {
    const outputDir = makeTempDir();
    const experimentDir = path.join(outputDir, 'force-replay');
    writeCachedTrail(experimentDir, baseRow, '');
    const modifyPrompt = vi.fn(() => ({}));
    mockFreshExecution();

    const results = await runReplay(
      { ...baseConfig(outputDir, 'force-replay', modifyPrompt), readCache: false },
      [baseRetrieved]
    );

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(modifyPrompt).toHaveBeenCalledTimes(1);
    expect(results[0].model).toBe('test/fresh-model');
  });

  it('reuses a cached prefix and restores repetition metadata for the remaining samples', async () => {
    const outputDir = makeTempDir();
    const experimentDir = path.join(outputDir, 'cache-prefix');
    writeCachedTrail(experimentDir, baseRow, '-fresh-model-1');
    mockFreshExecution();

    const results = await runReplay(
      baseConfig(outputDir, 'cache-prefix', () => ({}), {
        concurrency: 3,
        modelOverride: () => ['test/fresh-model@low', 'test/fresh-model@low', 'test/fresh-model@low'],
      }),
      [baseRetrieved]
    );

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(results.map(result => [result.model, result.repetition])).toEqual([
      ['test/cached-model', 1],
      ['test/fresh-model', 2],
      ['test/fresh-model', 3],
    ]);
    expect(readCsvRows(outputDir, 'cache-prefix').map(row => row.repetition)).toEqual(['1', '2', '3']);
  });

  it('fills cache holes and executes only the missing samples', async () => {
    const outputDir = makeTempDir();
    const experimentDir = path.join(outputDir, 'cache-holes');
    writeCachedTrail(experimentDir, baseRow, '-fresh-model-1');
    writeCachedTrail(experimentDir, baseRow, '-fresh-model-3');
    const modifyPrompt = vi.fn(() => ({}));
    mockFreshExecution();

    const results = await runReplay(
      baseConfig(outputDir, 'cache-holes', modifyPrompt, {
        modelOverride: () => ['test/fresh-model@low', 'test/fresh-model@low', 'test/fresh-model@low'],
      }),
      [baseRetrieved]
    );

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(modifyPrompt).toHaveBeenCalledTimes(1);
    expect(results.map(result => [result.model, result.repetition])).toEqual([
      ['test/cached-model', 1],
      ['test/fresh-model', 2],
      ['test/cached-model', 3],
    ]);
    expect(readCsvRows(outputDir, 'cache-holes').map(row => row.repetition)).toEqual(['1', '2', '3']);
  });

  it('skips model calls when every sample is cached and still publishes under a graceful stop', async () => {
    const outputDir = makeTempDir();
    const experimentDir = path.join(outputDir, 'cache-all');
    for (const suffix of ['-fresh-model-1', '-fresh-model-2', '-fresh-model-3']) {
      writeCachedTrail(experimentDir, baseRow, suffix);
    }
    const modifyPrompt = vi.fn(() => ({}));

    const results = await runReplay(
      baseConfig(outputDir, 'cache-all', modifyPrompt, {
        modelOverride: () => ['test/fresh-model@low', 'test/fresh-model@low', 'test/fresh-model@low'],
      }),
      [baseRetrieved],
      () => true
    );

    expect(mocks.execute).not.toHaveBeenCalled();
    expect(modifyPrompt).not.toHaveBeenCalled();
    expect(results.map(result => result.repetition)).toEqual([1, 2, 3]);
    expect(readCsvRows(outputDir, 'cache-all').map(row => row.repetition)).toEqual(['1', '2', '3']);
    // Setup and teardown still ran even though no chain admitted work.
    expect(mocks.forceFlush).toHaveBeenCalledTimes(1);
    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
  });

  it('does not let a cached prefix jump ahead of earlier episodes', async () => {
    const outputDir = makeTempDir();
    const experimentDir = path.join(outputDir, 'cache-priority');
    const repeatedRow = { ...baseRow, turn: '3' };
    const earlierRow = { ...baseRow, turn: '4' };
    writeCachedTrail(experimentDir, repeatedRow, '-fresh-model-1');
    const executedTurns: string[] = [];
    mocks.execute.mockImplementation(async (_agentName, input, _callback, tokenOutput) => {
      const parameters = mocks.runState.parameters;
      executedTurns.push(input.row.turn);
      tokenOutput.inputTokens = 5;
      return {
        row: input.row,
        model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
        decisions: [],
        tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
        messages: [],
      };
    });

    const results = await runReplay(
      baseConfig(outputDir, 'cache-priority', () => ({}), {
        concurrency: 1,
        modelOverride: (_original, row) => row.turn === '3'
          ? ['test/fresh-model@low', 'test/fresh-model@low']
          : ['test/solo@low'],
      }),
      [
        { ...baseRetrieved, row: earlierRow },
        { ...baseRetrieved, row: repeatedRow },
      ]
    );

    // The earlier untouched episode runs first. A cached hit must not seed the repeated chain
    // into the replay queue ahead of it.
    expect(executedTurns).toEqual(['4', '3']);
    expect(results.map(result => [result.row.turn, result.repetition])).toEqual([
      ['4', undefined],
      ['3', 1],
      ['3', 2],
    ]);
  });

  it('returns compact nonprefix results and leaves the CSV untouched after a graceful stop', async () => {
    const outputDir = makeTempDir();
    const experimentDir = path.join(outputDir, 'cache-stop');
    const repeatedRow = { ...baseRow, turn: '3' };
    const laterRow = { ...baseRow, turn: '4' };
    writeCachedTrail(experimentDir, repeatedRow, '-fresh-model-3');
    const csvPath = path.join(outputDir, 'cache-stop-results.csv');
    fs.writeFileSync(csvPath, 'PREVIOUS_COMPLETE_RUN', 'utf-8');
    const gate = deferred<void>();
    const executedTurns: string[] = [];
    mocks.execute.mockImplementation(async (_agentName, input, _callback, tokenOutput) => {
      const parameters = mocks.runState.parameters;
      executedTurns.push(input.row.turn);
      await gate.promise;
      tokenOutput.inputTokens = 5;
      return {
        row: input.row,
        model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
        decisions: [],
        tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
        messages: [],
      };
    });

    const stop = { value: false };
    const run = runReplay(
      baseConfig(outputDir, 'cache-stop', () => ({}), {
        concurrency: 1,
        modelOverride: (_original, row) => row.turn === '3'
          ? ['test/fresh-model@low', 'test/fresh-model@low', 'test/fresh-model@low']
          : ['test/solo@low'],
      }),
      [
        { ...baseRetrieved, row: repeatedRow },
        { ...baseRetrieved, row: laterRow },
      ],
      () => stop.value
    );

    await vi.waitFor(() => expect(executedTurns).toEqual(['3']));
    stop.value = true;
    gate.resolve();

    const results = await run;
    expect(executedTurns).toEqual(['3']);
    // The settled first sample and the cached third one remain, compact and in index order,
    // while the withheld middle sample and the untouched later episode are absent.
    expect(results.map(result => [result.row.turn, result.repetition])).toEqual([
      ['3', 1],
      ['3', 3],
    ]);
    expect(fs.readFileSync(csvPath, 'utf-8')).toBe('PREVIOUS_COMPLETE_RUN');
    expect(mocks.forceFlush).toHaveBeenCalledTimes(1);
  });
});

const baseRow = {
  game_id: 'game-1',
  player_id: '2',
  turn: '3',
  player_type: 'Test',
  rationale: 'original rationale',
};

const baseRetrieved: RetrievedRow = {
  row: baseRow,
  originalModel: 'test/fresh-model@low',
  agentName: 'simple-strategist',
  system: ['system prompt'],
  messages: [{ role: 'user', content: 'user message' }],
  activeTools: ['set-flavors'],
  files: false,
  prompts: false,
};

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

function cachedTrail(row: typeof baseRow = baseRow, model = 'test/cached-model', error?: string) {
  return {
    row,
    originalModel: 'test/fresh-model@low',
    model,
    modifications: {
      systemModified: false,
      messagesModified: false,
      activeToolsModified: false,
      metadata: { cached: true },
    },
    extractedColumns: { replay_nuke: 80 },
    ...(error ? { error } : {}),
    original: {
      system: ['system prompt'],
      messages: [{ role: 'user', content: 'user message' }],
    },
    replay: {
      system: ['system prompt'],
      decisions: [{ toolName: 'set-flavors', args: { GrandStrategy: 'Conquest' }, rationale: 'cached rationale' }],
      tokens: { inputTokens: 11, reasoningTokens: 22, outputTokens: 33 },
      messages: [{ role: 'assistant', content: 'cached response' }],
    },
  };
}

/** Writes a cached trail for one row and trail suffix. */
function writeCachedTrail(
  experimentDir: string,
  row: typeof baseRow,
  suffix: string,
  model = 'test/cached-model',
  error?: string
): void {
  fs.mkdirSync(experimentDir, { recursive: true });
  writeTrail(experimentDir, getTrailBase(row, suffix), cachedTrail(row, model, error));
}

/** Reads the results CSV as parsed rows. */
function readCsvRows(outputDir: string, experimentName: string): Record<string, string>[] {
  const csv = fs.readFileSync(path.join(outputDir, `${experimentName}-results.csv`), 'utf-8');
  return Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;
}

function mockFreshExecution(): void {
  mocks.execute.mockImplementation(async (_agentName, input, _callback, tokenOutput) => {
    const parameters = mocks.runState.parameters;
    tokenOutput.inputTokens = 101;
    tokenOutput.reasoningTokens = 202;
    tokenOutput.outputTokens = 303;
    return {
      row: input.row,
      model: `${parameters.resolvedModel.provider}/${parameters.resolvedModel.name}`,
      decisions: [{ toolName: 'set-flavors', args: { GrandStrategy: 'Spaceship' }, rationale: 'fresh rationale' }],
      tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
      messages: [{ role: 'assistant', content: 'fresh response' }],
    };
  });
}

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-cache-'));
  tempDirs.push(dir);
  return dir;
}
