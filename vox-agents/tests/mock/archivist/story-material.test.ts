import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoryMaterial } from '../../../src/archivist/pipeline/story-material.js';
import { summarizeWithCache } from '../../../src/telepathist/summarizer.js';
import { createTelepathistParameters, type TelepathistParameters } from '../../../src/telepathist/telepathist-parameters.js';
import { GetSituationTool } from '../../../src/telepathist/tools/get-situation.js';
import { createFakeVoxContext } from '../../helpers/fake-vox-context.js';
import { createTelemetryDb, type SpanSeed } from '../../helpers/telemetry-db.js';

vi.mock('../../../src/telepathist/summarizer.js', () => ({
  Summarizer: class { readonly name = 'summarizer'; },
  buildToolSummaryInstruction: vi.fn(),
  summarizeWithCache: vi.fn(),
}));

/** Record a tool's output under the player trace for this turn. */
function recordedTool(turn: number, tool: string, output: Record<string, unknown>): SpanSeed {
  return {
    turn, traceId: `trace-${turn}`, spanId: `${tool}-${turn}`, parentSpanId: `root-${turn}`,
    name: `mcp-tool.${tool}`,
    attributes: { 'tool.output': JSON.stringify(output) },
  };
}

describe('story reading material', () => {
  const cityDetails = 'Granaries and aqueducts. '.repeat(500);
  let params: TelepathistParameters;
  let dir: string | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'story-material-'));
    const dbPath = join(dir, 'player.db');
    const { sqlite } = createTelemetryDb([
      { turn: 10, traceId: 'trace-10', spanId: 'root-10', name: 'agent.strategist' },
      recordedTool(10, 'get-players', { Civilization: 'Babylon' }),
      recordedTool(10, 'get-victory-progress', { Leading: 'Korea' }),
      recordedTool(10, 'get-military-report', { Units: 'Companion Cavalry' }),
      recordedTool(10, 'get-cities', { Details: cityDetails }),
      recordedTool(10, 'get-events', { Founded: 'Nineveh' }),
      recordedTool(10, 'get-options', { Research: 'Ballistics' }),
      recordedTool(10, 'present-decision', { Decision: 'Invade Tyre' }),
      {
        turn: 10, traceId: 'trace-10', spanId: 'step-10', parentSpanId: 'root-10',
        name: 'agent.strategist.step.1',
        attributes: { 'step.responses': JSON.stringify([{ role: 'assistant', content: 'Keep horses in reserve' }]) },
      },
      { turn: 11, traceId: 'trace-11', spanId: 'root-11', name: 'agent.strategist' },
      recordedTool(11, 'get-options', { Research: 'Metallurgy' }),
    ]);
    try {
      await sqlite.backup(dbPath);
    } finally {
      sqlite.close();
    }
    params = await createTelepathistParameters(dbPath, { gameID: 'story-fixture', playerID: 2 });
  });

  beforeEach(() => {
    vi.mocked(summarizeWithCache).mockReset();
  });

  afterAll(async () => {
    await params?.close?.();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('should read game state without calling the summarizer, even for a large turn', async () => {
    const material = await readStoryMaterial(params, 10);

    expect(material).toContain('Babylon');
    expect(material).toContain('Korea');
    expect(material).toContain('Companion Cavalry');
    expect(material).toContain(cityDetails.trim());
    expect(material).toContain('Nineveh');
    expect(material).not.toContain('Ballistics');
    expect(material).not.toContain('Invade Tyre');
    expect(material).not.toContain('Keep horses in reserve');
    expect(summarizeWithCache).not.toHaveBeenCalled();
  });

  it('should skip turns without usable game state', async () => {
    expect(await readStoryMaterial(params, 11)).toBeNull();
    expect(await readStoryMaterial(params, 12)).toBeNull();
  });

  it('should still summarize a large detailed chat result with options included', async () => {
    const context = createFakeVoxContext();
    context.setBaseParameters(params);
    const summary = 'fixture summary';
    vi.mocked(summarizeWithCache).mockResolvedValue(summary);
    const tool = new GetSituationTool().createTool(context.asContext());

    const output = await tool.execute!({ Turns: '10', Detailed: true }, { messages: [], toolCallId: 'fixture-call' });

    expect(output).toBe(summary);
    expect(summarizeWithCache).toHaveBeenCalledOnce();
    expect(vi.mocked(summarizeWithCache).mock.calls[0][0].text).toContain('Ballistics');
  });
});
