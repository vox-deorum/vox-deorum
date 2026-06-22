import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OracleConfig, RetrievedRow } from '../../../src/oracle/types.js';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  createContext: vi.fn(),
  disconnect: vi.fn(),
  execute: vi.fn(),
  // Each replay task opens its own root via withRun({ parameters }); the fake just runs the
  // callback (which calls execute) and returns its result.
  withRun: vi.fn(async (_options: any, cb: (run: unknown) => unknown) =>
    cb({
      id: 'oracle-run',
      parameters: {},
      signal: new AbortController().signal,
      tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
      abort: () => {},
    })
  ),
  forceFlush: vi.fn(),
  loadToolSchemaCache: vi.fn(() => true),
  registerTools: vi.fn(),
  replaceToolsWithSchemaOnly: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock('../../../src/infra/vox-context.js', () => ({
  VoxContext: vi.fn().mockImplementation(() => ({
    execute: mocks.execute,
    withRun: mocks.withRun,
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
    fs.mkdirSync(experimentDir, { recursive: true });
    writeTrail(experimentDir, getTrailBase(baseRow, ''), cachedTrail());
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
    fs.mkdirSync(experimentDir, { recursive: true });
    writeTrail(experimentDir, getTrailBase(baseRow, ''), cachedTrail());
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
};

function baseConfig(outputDir: string, experimentName: string, modifyPrompt: OracleConfig['modifyPrompt']): OracleConfig {
  return {
    csvPath: 'unused.csv',
    experimentName,
    outputDir,
    modifyPrompt,
    concurrency: 1,
  };
}

function cachedTrail() {
  return {
    row: baseRow,
    originalModel: 'test/fresh-model@low',
    model: 'test/cached-model',
    modifications: {
      systemModified: false,
      messagesModified: false,
      activeToolsModified: false,
      metadata: { cached: true },
    },
    extractedColumns: { replay_nuke: 80 },
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

function mockFreshExecution(): void {
  mocks.execute.mockImplementation(async (_agentName, input, _callback, tokenOutput) => {
    tokenOutput.inputTokens = 101;
    tokenOutput.reasoningTokens = 202;
    tokenOutput.outputTokens = 303;
    return {
      row: input.row,
      model: 'test/fresh-model',
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
