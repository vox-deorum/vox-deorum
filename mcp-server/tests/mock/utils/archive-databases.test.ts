/**
 * Tests for the database snapshot in the archive utility (src/utils/knowledge/archive.ts).
 * The archive copies game and telemetry databases that another connection may still be
 * writing, so each copy must hold every committed row, including rows still in the source's
 * write-ahead log, and must be a closed single file.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/server.js', () => ({
  knowledgeManager: {},
}));

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { snapshotDatabase } from '../../../src/utils/knowledge/archive.js';

const tempDirs: string[] = [];
const openDbs: Database.Database[] = [];

/** Create a temp directory that is removed after each test. */
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-archive-db-'));
  tempDirs.push(dir);
  return dir;
}

/** Open a WAL database that never checkpoints on its own, so new rows stay in the WAL. */
function openWriter(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  openDbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of openDbs.splice(0)) if (db.open) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('snapshotDatabase', () => {
  it('copies rows still in the WAL of a connection that stays open', async () => {
    const dir = makeTempDir();
    const source = path.join(dir, 'game-player-0.db');
    const dest = path.join(dir, 'copy.db');
    const writer = openWriter(source);
    writer.exec('CREATE TABLE spans (id INTEGER PRIMARY KEY, name TEXT)');
    writer.prepare('INSERT INTO spans (name) VALUES (?)').run('turn-1');
    writer.prepare('INSERT INTO spans (name) VALUES (?)').run('turn-2');
    expect(fs.statSync(`${source}-wal`).size).toBeGreaterThan(0);

    await snapshotDatabase(source, dest);

    const copy = new Database(dest, { readonly: true });
    openDbs.push(copy);
    expect(copy.prepare('SELECT name FROM spans ORDER BY id').pluck().all()).toEqual(['turn-1', 'turn-2']);
    expect(copy.pragma('journal_mode', { simple: true })).toBe('delete');
    copy.close();
    expect(fs.existsSync(`${dest}-wal`)).toBe(false);
    expect(fs.existsSync(`${dest}-shm`)).toBe(false);

    // The source connection keeps working after the snapshot.
    writer.prepare('INSERT INTO spans (name) VALUES (?)').run('turn-3');
    expect(writer.prepare('SELECT COUNT(*) FROM spans').pluck().get()).toBe(3);
  });

  it('fails for a missing source without creating it', async () => {
    const dir = makeTempDir();
    const source = path.join(dir, 'missing.db');

    await expect(snapshotDatabase(source, path.join(dir, 'copy.db'))).rejects.toThrow();
    expect(fs.existsSync(source)).toBe(false);
  });
});
