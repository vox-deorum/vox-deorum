/**
 * Clustering contracts for saved story pitches, plus a source-CLI round trip
 * against a temporary DuckDB episode database.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DuckDBInstance, DuckDBListType, FLOAT, listValue, type DuckDBConnection } from '@duckdb/node-api';
import {
  clusterStoryPitches,
  renderStoryClusters,
  selectClusterExamples,
  type StoryPitchRow,
} from '../../../src/archivist/pipeline/story-clustering.js';

const consolePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/archivist/cluster-console.ts');
const tsxLoaderUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const realListType = new DuckDBListType(FLOAT);

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // DuckDB can keep a temporary file handle briefly on Windows.
    }
    tempDir = undefined;
  }
});

/** Build a pitch row with a clusterable default embedding. */
function pitch(overrides: Partial<StoryPitchRow> = {}): StoryPitchRow {
  return {
    gameId: 'game-a',
    playerId: 0,
    turn: 10,
    model: 'model-a',
    pitchIndex: 0,
    civilization: 'Rome',
    era: 'Classical Era',
    headline: 'Headline',
    pitch: 'Pitch text',
    embedding: [1, 0],
    createdAt: '2026-01-01 00:00:00',
    ...overrides,
  };
}

/** Open a temporary DuckDB fixture for one operation and close it afterwards. */
async function withDuckDb<T>(dbPath: string, use: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();
  try {
    return await use(connection);
  } finally {
    connection.disconnectSync();
    instance.closeSync();
  }
}

/** Create a story_pitches table and insert a controlled set of pitches. */
async function createPitchDatabase(dbPath: string, rows: StoryPitchRow[]): Promise<void> {
  await withDuckDb(dbPath, async connection => {
    await connection.run(`
      CREATE TABLE story_pitches (
        game_id VARCHAR NOT NULL, player_id INTEGER NOT NULL, turn INTEGER NOT NULL,
        model VARCHAR NOT NULL, pitch_index INTEGER NOT NULL,
        civilization VARCHAR NOT NULL, era VARCHAR NOT NULL,
        headline VARCHAR NOT NULL, pitch VARCHAR NOT NULL, embedding REAL[],
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const statement = await connection.prepare(`
      INSERT INTO story_pitches
        (game_id, player_id, turn, model, pitch_index, civilization, era, headline, pitch, embedding)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `);
    for (const row of rows) {
      statement.bindVarchar(1, row.gameId);
      statement.bindInteger(2, row.playerId);
      statement.bindInteger(3, row.turn);
      statement.bindVarchar(4, row.model);
      statement.bindInteger(5, row.pitchIndex);
      statement.bindVarchar(6, row.civilization);
      statement.bindVarchar(7, row.era);
      statement.bindVarchar(8, row.headline);
      statement.bindVarchar(9, row.pitch);
      if (row.embedding) statement.bindList(10, listValue(row.embedding), realListType);
      else statement.bindNull(10);
      await statement.run();
    }
  });
}

/** Run one source-CLI invocation in a temp folder with production logging. */
function runCluster(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoaderUrl, consolePath, ...args], {
      cwd: tempDir,
      env: { ...process.env, LOG_LEVEL: 'error', NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`Cluster CLI exited with ${code ?? signal}: ${output}`), { code }));
    });
  });
}

describe('story pitch clustering', () => {
  it('should join the first matching cluster rather than the closest one', () => {
    const result = clusterStoryPitches([
      pitch({ turn: 1, headline: 'First', embedding: [1, 0] }),
      pitch({ turn: 2, headline: 'Second', embedding: [0, 1] }),
      // Similar to both centers, but closer to the second cluster.
      pitch({ turn: 3, headline: 'Third', embedding: [0.7, Math.sqrt(1 - 0.7 * 0.7)] }),
    ], 0.6);

    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0].members.map(member => member.headline)).toEqual(['First', 'Third']);
    expect(result.clusters[1].members.map(member => member.headline)).toEqual(['Second']);
  });

  it('should change later assignments as the running center moves', () => {
    const result = clusterStoryPitches([
      pitch({ turn: 1, embedding: [1, 0] }),
      pitch({ turn: 2, embedding: [0.8, 0.6] }),
      // Below 0.75 against the first pitch, but above 0.75 against the moved center.
      pitch({ turn: 3, embedding: [0.6, 0.8] }),
    ], 0.75);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].members).toHaveLength(3);
  });

  it('should keep singletons', () => {
    const result = clusterStoryPitches([
      pitch({ turn: 1, embedding: [1, 0] }),
      pitch({ turn: 2, embedding: [0, 1] }),
      pitch({ turn: 3, embedding: [-1, 0] }),
    ], 0.8);

    expect(result.clusters).toHaveLength(3);
    expect(result.clusters.map(cluster => cluster.members.length)).toEqual([1, 1, 1]);
  });

  it('should include a pitch at exactly the threshold', () => {
    const rows = [
      pitch({ turn: 1, embedding: [1, 0] }),
      pitch({ turn: 2, embedding: [0.6, 0.8] }),
    ];

    expect(clusterStoryPitches(rows, 0.6).clusters).toHaveLength(1);
    expect(clusterStoryPitches(rows, 0.61).clusters).toHaveLength(2);
  });

  it('should skip null, empty, non-finite, mixed-null, and zero embeddings', () => {
    const result = clusterStoryPitches([
      pitch({ turn: 1, embedding: [1, 0] }),
      pitch({ turn: 2, embedding: null }),
      pitch({ turn: 3, embedding: [] }),
      pitch({ turn: 4, embedding: [0, 0] }),
      pitch({ turn: 5, embedding: [Number.NaN, 1] }),
      pitch({ turn: 6, embedding: [1, null as unknown as number] }),
    ], 0.8);

    expect(result.rowsRead).toBe(6);
    expect(result.clustered).toBe(1);
    expect(result.skipped).toBe(5);
    expect(result.clusters[0].members.map(member => member.turn)).toEqual([1]);
  });

  it('should report mixed embedding dimensions instead of clustering them', () => {
    expect(() => clusterStoryPitches([
      pitch({ turn: 1, embedding: [1, 0] }),
      pitch({ turn: 2, embedding: [1, 0, 0] }),
    ], 0.8)).toThrow(/mixed dimensions.*2 dimensions: 1.*3 dimensions: 1/i);
  });

  it('should fail with guidance when no usable vectors remain', () => {
    expect(() => clusterStoryPitches([pitch({ embedding: null })], 0.8)).toThrow(/embedder/i);
  });

  it('should group seven identical vectors at a threshold of one', () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      pitch({ turn: index + 1, embedding: [1, 1, 3] })
    );

    const result = clusterStoryPitches(rows, 1);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].members).toHaveLength(7);
  });

  it('should order the report by cluster size with creation order as the tie break', () => {
    const clustering = clusterStoryPitches([
      pitch({ turn: 4, headline: 'Small first', embedding: [0, 1] }),
      pitch({ turn: 1, headline: 'Big one', embedding: [1, 0] }),
      pitch({ turn: 2, headline: 'Big two', embedding: [1, 0] }),
      pitch({ turn: 3, headline: 'Big three', embedding: [1, 0] }),
      pitch({ turn: 5, headline: 'Small second', embedding: [-1, 0] }),
    ], 0.8);
    const report = renderStoryClusters(clustering);

    expect(report.indexOf('**Big one**')).toBeLessThan(report.indexOf('**Small first**'));
    expect(report.indexOf('**Small first**')).toBeLessThan(report.indexOf('**Small second**'));
  });

  it('should select examples from new models, then new games, then key order', () => {
    const members = [
      pitch({ turn: 1, model: 'model-a', gameId: 'game-a', headline: 'First' }),
      pitch({ turn: 2, model: 'model-a', gameId: 'game-a', headline: 'Same model and game' }),
      pitch({ turn: 3, model: 'model-b', gameId: 'game-a', headline: 'New model' }),
      pitch({ turn: 4, model: 'model-b', gameId: 'game-b', headline: 'New game' }),
      pitch({ turn: 5, model: 'model-a', gameId: 'game-b', headline: 'Remaining' }),
    ];

    expect(selectClusterExamples(members).map(member => member.headline))
      .toEqual(['First', 'New model', 'New game']);
  });

  it('should fill remaining examples in stable key order', () => {
    const members = [
      pitch({ turn: 1, model: 'model-a', gameId: 'game-a', headline: 'First' }),
      pitch({ turn: 2, model: 'model-a', gameId: 'game-a', headline: 'Second' }),
      pitch({ turn: 3, model: 'model-a', gameId: 'game-a', headline: 'Third' }),
      pitch({ turn: 4, model: 'model-a', gameId: 'game-a', headline: 'Fourth' }),
    ];

    expect(selectClusterExamples(members).map(member => member.headline))
      .toEqual(['First', 'Second', 'Third']);
  });

  it('should escape HTML and inline Markdown in example text', () => {
    const report = renderStoryClusters(clusterStoryPitches([
      pitch({ headline: '<b>Bold</b> *markdown*', pitch: 'Line one\nline two', embedding: [1, 0] }),
    ], 0.8));

    expect(report).toContain('&lt;b&gt;Bold&lt;/b&gt; \\*markdown\\*');
    expect(report).toContain('Line one line two');
    expect(report).not.toContain('<b>');
  });

  it('should render the totals, newest timestamp, and cluster counts', () => {
    const clustering = clusterStoryPitches([
      pitch({ turn: 1, embedding: [1, 0], createdAt: '2026-01-01 00:00:00' }),
      pitch({ turn: 2, embedding: [1, 0], createdAt: '2026-01-02 12:00:00' }),
      pitch({ turn: 3, embedding: null, createdAt: '2026-01-03 00:00:00' }),
    ], 0.8);
    const report = renderStoryClusters(clustering);

    expect(clustering.mostRecentCreatedAt).toBe('2026-01-03 00:00:00');
    expect(report).toContain('Rows read: 3');
    expect(report).toContain('Clustered: 2');
    expect(report).toContain('Skipped: 1');
    expect(report).toContain('Most recent saved pitch: 2026-01-03 00:00:00');
    expect(report).toContain('(2 pitches)');
  });
});

describe('story clustering CLI', () => {
  it('should read a fixture and write an ordered report without changing the input', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-cluster-'));
    const inputPath = path.join(tempDir, 'episodes.duckdb');
    const outputPath = path.join(tempDir, 'clusters.md');
    await createPitchDatabase(inputPath, [
      pitch({ turn: 1, model: 'model-a', gameId: 'game-a', era: 'Classical Era', headline: 'Big one', embedding: [1, 0] }),
      pitch({ turn: 2, model: 'model-a', gameId: 'game-a', era: 'Classical Era', headline: 'Same model', embedding: [1, 0] }),
      pitch({ turn: 3, model: 'model-b', gameId: 'game-a', era: 'Medieval Era', headline: 'New model', embedding: [1, 0] }),
      pitch({ turn: 4, model: 'model-a', gameId: 'game-b', era: 'Classical Era', headline: 'New game', embedding: [1, 0] }),
      pitch({ turn: 5, model: 'model-c', gameId: 'game-b', era: 'Industrial Era', headline: 'Medium one', embedding: [0, 1] }),
      pitch({ turn: 6, model: 'model-a', gameId: 'game-c', era: 'Modern Era', headline: 'Medium two', embedding: [0, 1] }),
      pitch({ turn: 7, model: 'model-c', gameId: 'game-c', era: 'Classical Era', headline: 'Lonely', embedding: [-1, 0] }),
      pitch({ turn: 8, model: 'model-c', gameId: 'game-d', era: 'Classical Era', headline: 'No vector', embedding: null }),
    ]);
    const before = fs.readFileSync(inputPath);

    await runCluster(['-i', inputPath, '-o', outputPath]);

    const report = fs.readFileSync(outputPath, 'utf8');
    expect(report).toContain('Rows read: 8');
    expect(report).toContain('Clustered: 7');
    expect(report).toContain('Skipped: 1');
    expect(report).toContain('Threshold: 0.8');
    expect(report).toContain('Clusters: 3');
    const headings = report.split('\n').filter(line => line.startsWith('## Cluster'));
    expect(headings).toEqual([
      '## Cluster 1 (4 pitches)',
      '## Cluster 2 (2 pitches)',
      '## Cluster 3 (1 pitch)',
    ]);
    expect(report).toContain('**Big one**');
    expect(report).toContain('**New model**');
    expect(report).toContain('**New game**');
    expect(report).not.toContain('**Same model**');
    expect(report.indexOf('**Big one**')).toBeLessThan(report.indexOf('**New model**'));
    expect(report.indexOf('**New model**')).toBeLessThan(report.indexOf('**New game**'));
    expect(report).toContain('**Lonely**');
    expect(report).not.toContain('**No vector**');
    expect(fs.readFileSync(inputPath).equals(before)).toBe(true);
  }, 60_000);

  it('should keep an existing report when the story table is missing', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-cluster-'));
    const inputPath = path.join(tempDir, 'unrelated.duckdb');
    const outputPath = path.join(tempDir, 'clusters.md');
    await withDuckDb(inputPath, async connection => {
      await connection.run('CREATE TABLE unrelated (id INTEGER)');
    });
    fs.writeFileSync(outputPath, 'keep this report');

    await expect(runCluster(['-i', inputPath, '-o', outputPath]))
      .rejects.toMatchObject({ code: 1 });
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('keep this report');
  }, 60_000);

  it('should refuse to write over the input database or its WAL', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-cluster-'));
    const inputPath = path.join(tempDir, 'episodes.duckdb');
    await createPitchDatabase(inputPath, [
      pitch({ turn: 1, embedding: [1, 0] }),
    ]);
    const before = fs.readFileSync(inputPath);

    await expect(runCluster(['-i', inputPath, '-o', inputPath]))
      .rejects.toMatchObject({ code: 1 });
    expect(fs.readFileSync(inputPath).equals(before)).toBe(true);

    await expect(runCluster(['-i', inputPath, '-o', `${inputPath}.wal`]))
      .rejects.toMatchObject({ code: 1 });
    expect(fs.readFileSync(inputPath).equals(before)).toBe(true);
    expect(fs.existsSync(`${inputPath}.wal`)).toBe(false);
  }, 60_000);
});
