/**
 * End-to-end resume and force coverage for the Archivist source CLI.
 * Uses a real SQLite archive fixture and a real DuckDB output file.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { spansTableSql } from '../../../src/utils/telemetry/schema.js';
import { seedKnowledgePlayers } from '../../helpers/knowledge-db.js';
import { insertSpans } from '../../helpers/telemetry-db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const consolePath = path.resolve(__dirname, '../../../src/archivist/console.ts');
// The child runs from a temp directory, so resolve tsx's public entry here instead of by bare name.
const tsxLoaderUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

let tempDir: string | undefined;
let occupiedSockets: net.Server[] = [];

/** Listen on the requested loopback port and resolve after binding succeeds. */
function listenOnLoopback(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

/** Release a loopback socket and wait until its operating-system handle closes. */
function closeSocket(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

/** Reserve two adjacent ports so the CLI server's primary and fallback binds both fail. */
async function reserveAdjacentPortPair(): Promise<{ firstPort: number; sockets: net.Server[] }> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const first = await listenOnLoopback(0);
    const address = first.address();
    const firstPort = typeof address === 'object' && address ? address.port : 0;
    if (firstPort === 0 || firstPort >= 65535) {
      await closeSocket(first);
      continue;
    }

    try {
      const second = await listenOnLoopback(firstPort + 1);
      return { firstPort, sockets: [first, second] };
    } catch {
      await closeSocket(first);
    }
  }

  throw new Error('Could not reserve adjacent loopback ports for the Archivist CLI');
}

/** Run one source-CLI invocation with isolated paths and a bounded completion time. */
function runArchivist(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoaderUrl, consolePath, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.stdin.end();
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.stdout.resume();
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Archivist CLI exited with ${code ?? signal}: ${stderr}`));
    });
  });
}

/** Create the knowledge tables read by archive discovery and phase-A extraction. */
function createKnowledgeDatabase(dbPath: string, score: number): void {
  const db = new Database(dbPath);
  seedKnowledgePlayers(db);
  db.exec(`
    CREATE TABLE FlavorChanges (ID INTEGER PRIMARY KEY, Key INTEGER, IsLatest INTEGER);
    CREATE TABLE PlayerSummaries (
      ID INTEGER PRIMARY KEY AUTOINCREMENT, Key INTEGER, Turn INTEGER, Score INTEGER,
      Era TEXT, Votes INTEGER, MajorAlly TEXT, Cities INTEGER, Population INTEGER,
      GoldPerTurn REAL, HappinessPercentage REAL, TourismPerTurn REAL,
      CulturePerTurn REAL, MilitaryUnits INTEGER, MilitarySupply INTEGER,
      MilitaryStrength REAL, Technologies INTEGER, PolicyBranches TEXT, Relationships TEXT
    );
    CREATE TABLE CityInformations (
      ID INTEGER PRIMARY KEY AUTOINCREMENT, Key INTEGER, Turn INTEGER, Owner TEXT,
      MajorityReligion TEXT, ProductionPerTurn REAL, FoodPerTurn REAL, Population INTEGER
    );
    CREATE TABLE VictoryProgress (
      ID INTEGER PRIMARY KEY AUTOINCREMENT, Key INTEGER, Turn INTEGER,
      DominationVictory TEXT, ScienceVictory TEXT, CulturalVictory TEXT, DiplomaticVictory TEXT
    );
    CREATE TABLE StrategyChanges (
      ID INTEGER PRIMARY KEY AUTOINCREMENT, Key INTEGER, Turn INTEGER, GrandStrategy TEXT
    );
  `);
  db.prepare('INSERT INTO FlavorChanges (ID, Key, IsLatest) VALUES (1, 0, 1)').run();
  db.prepare(`INSERT INTO PlayerSummaries
    (Key, Turn, Score, Era, Votes, MajorAlly, Cities, Population, GoldPerTurn,
     HappinessPercentage, TourismPerTurn, CulturePerTurn, MilitaryUnits,
     MilitarySupply, MilitaryStrength, Technologies, PolicyBranches, Relationships)
    VALUES (0, 10, ?, 'Classical Era', 0, NULL, 2, 20, 4, 50, 1, 2, 3, 5, 6, 7, '{}', '{}')`).run(score);
  db.prepare(`INSERT INTO CityInformations
    (Key, Turn, Owner, MajorityReligion, ProductionPerTurn, FoodPerTurn, Population)
    VALUES (1, 10, 'Rome', NULL, 3, 4, 10)`).run();
  db.prepare(`INSERT INTO VictoryProgress
    (Key, Turn, DominationVictory, ScienceVictory, CulturalVictory, DiplomaticVictory)
    VALUES (0, 10, '{}', '{}', '{}', '{}')`).run();
  db.prepare(`INSERT INTO StrategyChanges (Key, Turn, GrandStrategy) VALUES (0, 10, 'Conquest')`).run();
  db.close();
}

/** Create the telemetry database row that marks the fixture turn as agent-processed. */
function createTelemetryDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(spansTableSql);
  insertSpans(db, [{ turn: 10, traceId: 'trace-10', spanId: 'span-10', name: 'agent.strategist' }]);
  db.close();
}

/** Read one player-turn score from the real DuckDB output, closing all DuckDB handles. */
async function readEpisodeScore(dbPath: string): Promise<number | null> {
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll(
      "SELECT score FROM episodes WHERE game_id = 'fixture-game' AND turn = 10 AND player_id = 0"
    );
    const rows = result.getRowObjects() as Array<{ score: number | null }>;
    return rows[0]?.score ?? null;
  } finally {
    connection.disconnectSync();
    instance.closeSync();
  }
}

afterEach(async () => {
  for (const socket of occupiedSockets.splice(0)) {
    await closeSocket(socket);
  }
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('Archivist source CLI', () => {
  it('should skip processed players on resume and refresh them with force', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivist-console-'));
    const archiveDir = path.join(tempDir, 'archive');
    const workDir = path.join(tempDir, 'work');
    const telemetryDir = path.join(tempDir, 'telemetry');
    const configsDir = path.join(tempDir, 'configs');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.mkdirSync(configsDir, { recursive: true });

    const gameDbPath = path.join(archiveDir, 'fixture-game_20261015.db');
    const telemetryDbPath = path.join(archiveDir, 'fixture-game-player-0.db');
    const outputPath = path.join(tempDir, 'episodes.duckdb');
    createKnowledgeDatabase(gameDbPath, 101);
    createTelemetryDatabase(telemetryDbPath);

    const { firstPort, sockets } = await reserveAdjacentPortPair();
    occupiedSockets = sockets;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      WEBUI_PORT: String(firstPort),
      VOX_SHUTDOWN_URL_FILE: path.join(tempDir, 'shutdown-url.txt'),
      TELEMETRY_DIR: telemetryDir,
      CONFIGS_DIR: configsDir,
      EPISODE_DB_PATH: outputPath,
      LOG_LEVEL: 'error',
      NODE_ENV: 'production',
    };
    const args = [
      '--archive', archiveDir,
      '--output', outputPath,
      '--skip-telepathist',
      '--skip-embeddings',
      '--no-ui',
    ];

    await runArchivist(args, workDir, env);
    expect(await readEpisodeScore(outputPath)).toBe(101);

    const updateDb = new Database(gameDbPath);
    updateDb.prepare('UPDATE PlayerSummaries SET Score = ? WHERE Key = ? AND Turn = ?').run(202, 0, 10);
    updateDb.close();

    await runArchivist(args, workDir, env);
    expect(await readEpisodeScore(outputPath)).toBe(101);

    await runArchivist([...args, '--force'], workDir, env);
    expect(await readEpisodeScore(outputPath)).toBe(202);
  }, 120_000);
});
