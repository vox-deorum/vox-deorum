import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wrapLanguageModel } from 'ai';
import { MockEmbeddingModelV4, MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../src/agents/config/load.js';
import { getEmbeddingModel, getModel } from '../../../src/agents/models/models.js';
import { toolRescueMiddleware } from '../../../src/agents/models/tool-rescue/middleware.js';
import { getEpisodeDbInstance } from '../../../src/archivist/episode-db.js';
import { createStoryMiner, defaultStorySeed } from '../../../src/archivist/pipeline/story-mining.js';
import { EpisodeWriter } from '../../../src/archivist/pipeline/writer.js';
import type { ArchiveEntry } from '../../../src/archivist/types.js';
import { GetSituationTool } from '../../../src/telepathist/tools/get-situation.js';
import { createTelemetryDb, type SpanSeed } from '../../helpers/telemetry-db.js';

vi.mock('../../../src/agents/models/models.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/agents/models/models.js')>(),
  getModel: vi.fn(),
  getEmbeddingModel: vi.fn(),
}));

const gameId = 'story-game';
const playerId = 2;
const firstModel = 'model-a';
const secondModel = 'model-b';
const defaultModel = 'openai/scout-a';
const otherModel = 'openai/scout-b';
const originalModels = config.llms;
const options = { turnCount: 1, seed: defaultStorySeed, force: false, skipEmbeddings: false };

/** Produce a complete set of pitches with a distinguishable revision. */
function samplePitches(label: string, count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    headline: `${label} ${i + 1}`,
    pitch: 'A new granary changes where the market meets.',
    genre: 'City life',
    stance: 'Curious',
    subject: 'Nineveh',
    basis: 'Granary recorded in Nineveh',
    wants: i === 0 ? '' : 'Who can use the granary?',
  }));
}

/** Stream one scripted response per call, with no provider or network access. */
function mockScout(...replies: (Error | { pitches: ReturnType<typeof samplePitches> })[]) {
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const reply = replies.shift();
      if (!reply) throw Object.assign(new Error('Unexpected scout call'), { isRetryable: false });
      if (reply instanceof Error) throw reply;
      return {
        stream: simulateReadableStream({ chunks: [
          { type: 'text-start', id: 'scout' },
          { type: 'text-delta', id: 'scout', delta: JSON.stringify(reply) },
          { type: 'text-end', id: 'scout' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 50, noCache: 50, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 100, text: 100, reasoning: 0 },
            },
          },
        ] }),
      };
    },
  });
  // As in the real model factory, preserve provider errors through the AI SDK stream.
  vi.mocked(getModel).mockReturnValue(wrapLanguageModel({ model, middleware: toolRescueMiddleware() }));
  return model;
}

describe('archivist story mining', () => {
  let dir: string;
  let dbPath: string;
  let writer: EpisodeWriter;

  beforeEach(async () => {
    vi.resetAllMocks();
    config.llms = {
      default: firstModel,
      [firstModel]: defaultModel,
      [defaultModel]: { provider: 'openai', name: 'scout-a' },
      [secondModel]: { provider: 'openai', name: 'scout-b' },
    };
    dir = await mkdtemp(join(tmpdir(), 'story-mining-'));
    dbPath = join(dir, 'episodes.duckdb');
    writer = await EpisodeWriter.create(dbPath);
  });

  afterEach(async () => {
    config.llms = originalModels;
    await writer?.close();
    // DuckDB caches instances and can keep the file open on Windows.
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  /** Seed real recorded tool output and the matching rows left by Phase A. */
  async function seedArchive(materialByTurn: Record<number, string | null>): Promise<ArchiveEntry> {
    const spans: SpanSeed[] = [];
    const conn = await (await getEpisodeDbInstance(dbPath)).connect();
    try {
      for (const [key, material] of Object.entries(materialByTurn)) {
        const turn = Number(key);
        const traceId = `trace-${turn}`;
        const root = `root-${turn}`;
        spans.push({ turn, traceId, spanId: root, name: 'agent.strategist' });
        if (material !== null) {
          spans.push({
            turn, traceId, spanId: `cities-${turn}`, parentSpanId: root, name: 'mcp-tool.get-cities',
            attributes: { 'tool.output': JSON.stringify({ Details: material }) },
          });
        }
        await conn.run(
          'INSERT INTO episodes (game_id, player_id, turn, civilization, era, is_winner) VALUES (?, ?, ?, ?, ?, false)',
          [gameId, playerId, turn, 'Babylon', turn === 10 ? 'Classical Era' : 'Medieval Era'],
        );
      }
    } finally {
      conn.disconnectSync();
    }

    const telemetryDbPath = join(dir, 'player.db');
    const { sqlite } = createTelemetryDb(spans);
    try {
      await sqlite.backup(telemetryDbPath);
    } finally {
      sqlite.close();
    }
    return {
      gameId, experiment: 'fixture', gameDbPath: join(dir, 'knowledge.db'),
      players: [{ playerId, telemetryDbPath, telepathistDbPath: join(dir, 'player.telepathist.db') }],
    };
  }

  /** Read the stored pitches from DuckDB with vectors converted to JS arrays. */
  async function readRows() {
    const conn = await (await getEpisodeDbInstance(dbPath)).connect();
    try {
      return (await conn.runAndReadAll('SELECT * FROM story_pitches ORDER BY model, turn, pitch_index')).getRowObjectsJS();
    } finally {
      conn.disconnectSync();
    }
  }

  it('should store a validated sample with the episode identity and one embedding per pitch', async () => {
    const entry = await seedArchive({ 10: 'Nineveh built a granary' });
    const pitches = samplePitches('Market notes');
    const scout = mockScout({ pitches });
    config.llms.embedder = { provider: 'openai', name: 'embedding-fixture', options: { embeddingSize: 2 } };
    const embedder = new MockEmbeddingModelV4({
      maxEmbeddingsPerCall: null,
      doEmbed: async ({ values }) => ({ embeddings: values.map((_, i) => [i, 0.25, 1]) }),
    });
    vi.mocked(getEmbeddingModel).mockReturnValue(embedder);
    const mine = await createStoryMiner(options);

    expect(await mine(entry, writer)).toEqual({ errors: 0, samplesSaved: 1 });

    expect(scout.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(scout.doStreamCalls[0].prompt)).toContain('Nineveh built a granary');
    expect(embedder.doEmbedCalls[0].values).toEqual(pitches.map(p => `${p.headline}\n${p.pitch}`));
    expect(await readRows()).toMatchObject(pitches.map((pitch, pitchIndex) => ({
      game_id: gameId, player_id: playerId, turn: 10, model: defaultModel, pitch_index: pitchIndex,
      civilization: 'Babylon', era: 'Classical Era', ...pitch, embedding: [pitchIndex, 0.25],
    })));
  });

  it('should share a resume key between an alias and its target and replace only that model’s sample', async () => {
    const entry = await seedArchive({ 10: 'Nineveh built a granary' });
    const initial = samplePitches('Morning edition', 6);
    const other = samplePitches('Rival edition');
    const replacement = samplePitches('Evening edition');
    const scout = mockScout({ pitches: initial }, { pitches: other }, { pitches: replacement });
    const mineFirst = await createStoryMiner(options, firstModel);
    const mineSame = await createStoryMiner(options, defaultModel);
    const mineOther = await createStoryMiner(options, secondModel);

    expect(await mineFirst(entry, writer)).toEqual({ errors: 0, samplesSaved: 1 });
    expect(await mineSame(entry, writer)).toEqual({ errors: 0, samplesSaved: 0 });
    expect(scout.doStreamCalls).toHaveLength(1);
    expect(await mineOther(entry, writer)).toEqual({ errors: 0, samplesSaved: 1 });
    expect(await readRows()).toMatchObject([
      ...initial.map(p => ({ model: defaultModel, headline: p.headline })),
      ...other.map(p => ({ model: otherModel, headline: p.headline })),
    ]);

    const forceMine = await createStoryMiner({ ...options, force: true }, defaultModel);
    expect(await forceMine(entry, writer)).toEqual({ errors: 0, samplesSaved: 1 });
    expect(scout.doStreamCalls).toHaveLength(3);
    expect(vi.mocked(getModel).mock.calls.map(([model]) => model.name)).toEqual(['scout-a', 'scout-b', 'scout-a']);
    expect(await readRows()).toMatchObject([
      ...replacement.map(p => ({ model: defaultModel, headline: p.headline })),
      ...other.map(p => ({ model: otherModel, headline: p.headline })),
    ]);
  });

  it('should count provider and validation errors, skip absent material and overflow, and save the next sample', async () => {
    const entry = await seedArchive({
      10: null, 11: 'Oversized turn', 12: 'Incomplete pitches', 13: 'Provider failure', 14: 'Nineveh built a granary',
    });
    const pitches = samplePitches('Market notes');
    const scout = mockScout(new Error('maximum context length exceeded'), { pitches: pitches.slice(0, 4) },
      Object.assign(new Error('Provider rejected the request'), { isRetryable: false }), { pitches });
    const mine = await createStoryMiner({ ...options, turnCount: 6 });

    expect(await mine(entry, writer)).toEqual({ errors: 2, samplesSaved: 1 });

    expect(scout.doStreamCalls).toHaveLength(4);
    expect(vi.mocked(getEmbeddingModel)).not.toHaveBeenCalled();
    expect(await readRows()).toMatchObject(pitches.map(p => ({
      turn: 14, era: 'Medieval Era', headline: p.headline, embedding: null,
    })));
  });

  it('should skip detailed telemetry reads when the player has no episodes', async () => {
    const entry = await seedArchive({ 10: 'A city was founded', 11: 'A market opened' });
    await writer.deletePlayerEpisodes(gameId, playerId);
    const readTurn = vi.spyOn(GetSituationTool.prototype, 'readDetailedTurn');
    try {
      const mine = await createStoryMiner({ ...options, turnCount: 2 });
      expect(await mine(entry, writer)).toEqual({ errors: 0, samplesSaved: 0 });
      expect(readTurn).not.toHaveBeenCalled();
    } finally {
      readTurn.mockRestore();
    }
  });

  it('should roll back a forced replacement when DuckDB rejects a new pitch and save the next sample', async () => {
    const entry = await seedArchive({ 10: 'A city was founded', 11: 'A market opened' });
    const original = samplePitches('Morning edition');
    const replacement = samplePitches('Evening edition');
    mockScout({ pitches: original }, { pitches: original }, { pitches: replacement }, { pitches: replacement });
    config.llms.embedder = { provider: 'openai', name: 'embedding-fixture' };
    const mine = await createStoryMiner({ ...options, turnCount: 2, skipEmbeddings: true });
    expect(await mine(entry, writer)).toEqual({ errors: 0, samplesSaved: 2 });

    const write = writer.writeStoryPitches.bind(writer);
    vi.spyOn(writer, 'writeStoryPitches').mockImplementationOnce((key, episode, pitches, replace) => {
      // Violate the real DuckDB NOT NULL constraint after the scout has validated its output.
      Object.assign(pitches[1], { headline: null });
      return write(key, episode, pitches, replace);
    });
    const forceMine = await createStoryMiner({ ...options, turnCount: 2, force: true, skipEmbeddings: true });
    expect(await forceMine(entry, writer)).toEqual({ errors: 1, samplesSaved: 1 });

    expect(vi.mocked(getEmbeddingModel)).not.toHaveBeenCalled();
    expect(await readRows()).toMatchObject([
      ...original.map(p => ({ turn: 10, headline: p.headline, embedding: null })),
      ...replacement.map(p => ({ turn: 11, headline: p.headline, embedding: null })),
    ]);
  });

  it('should keep the old pitches when a configured embedder fails during a forced replacement', async () => {
    const entry = await seedArchive({ 10: 'A city was founded' });
    const original = samplePitches('Morning edition');
    mockScout({ pitches: original }, { pitches: samplePitches('Evening edition') });
    const mine = await createStoryMiner(options);
    expect(await mine(entry, writer)).toEqual({ errors: 0, samplesSaved: 1 });

    config.llms.embedder = { provider: 'openai', name: 'embedding-fixture' };
    vi.mocked(getEmbeddingModel).mockReturnValue(new MockEmbeddingModelV4({
      maxEmbeddingsPerCall: null,
      doEmbed: async () => { throw new Error('Embedder unavailable'); },
    }));
    const forceMine = await createStoryMiner({ ...options, force: true });
    expect(await forceMine(entry, writer)).toEqual({ errors: 1, samplesSaved: 0 });
    expect(await readRows()).toMatchObject(original.map(p => ({ headline: p.headline })));
  });
});
