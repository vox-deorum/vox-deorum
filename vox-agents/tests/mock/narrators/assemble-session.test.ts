/** Public assembly coverage for the narrator's Stage 1 output manifest. */
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AssembleSession } from '../../../src/narrators/sessions/assemble-session.js';
import { seedKnowledgePlayers } from '../../helpers/knowledge-db.js';

let tempDir: string | undefined;

/** Create the minimal real knowledge database used by a major-player assembly. */
function createKnowledgeDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  seedKnowledgePlayers(db);
  db.exec(`
    CREATE TABLE GameEvents (
      ID INTEGER PRIMARY KEY, Turn INTEGER, Type TEXT, Payload TEXT, Player0 INTEGER
    );
  `);
  db.prepare('INSERT INTO GameEvents (ID, Turn, Type, Payload, Player0) VALUES (?, ?, ?, ?, ?)').run(
    1, 10, 'TechnologyResearched', '{}', 1
  );
  db.close();
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('AssembleSession', () => {
  it('should write player, winner, and visible event enrichment to episodes.json', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrator-assemble-'));
    const recordingDir = path.join(tempDir, 'recording');
    const workspace = path.join(tempDir, 'workspace');
    const knowledgePath = path.join(tempDir, 'knowledge.db');
    fs.mkdirSync(recordingDir, { recursive: true });
    createKnowledgeDatabase(knowledgePath);
    fs.writeFileSync(path.join(recordingDir, 'segments.jsonl'), [
      JSON.stringify({ event: 'start', turn: 10, playerID: 0, at: 1_000 }),
      JSON.stringify({ event: 'stop', turn: 10, playerID: 0, at: 6_000, file: 'game.mkv' }),
    ].join('\n'));

    const session = new AssembleSession({
      type: 'narrator-assemble',
      workspace,
      gameID: 'assemble-fixture',
      recordingDir,
      knowledgePath,
    } as any);
    await session.start();

    const output = JSON.parse(fs.readFileSync(path.join(workspace, 'episodes.json'), 'utf8'));

    expect(output.players).toEqual([
      expect.objectContaining({ Key: 0, Civilization: 'Rome', Leader: 'Augustus' }),
    ]);
    expect(output.winner).toEqual({ playerID: 0, victoryType: 'Science' });
    expect(output.totalTurns).toBe(10);
    expect(output.episodes).toEqual([
      expect.objectContaining({
        turn: 10,
        playerID: 0,
        sourceFile: 'game.mkv',
        offset: 0,
        duration: 5_000,
        eventCounts: { TechnologyResearched: 1 },
      }),
    ]);
  });
});
