import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'kysely';
import { openReplayDatabase, readReplayIdentities } from '../../../../src/newspaper/replay/database.js';
import { createReplayRecording } from '../../../helpers/newspaper-replay.js';

describe('replay read-only database', () => {
  let recording: Awaited<ReturnType<typeof createReplayRecording>>;
  let db: Awaited<ReturnType<typeof openReplayDatabase>> | undefined;
  beforeEach(async () => { recording = await createReplayRecording(); });
  afterEach(async () => {
    await db?.destroy();
    vi.restoreAllMocks();
    await recording.cleanup();
  });

  it('should close an unused source without executing SQL or setting up a schema', async () => {
    const close = vi.spyOn(Database.prototype, 'close');
    const prepare = vi.spyOn(Database.prototype, 'prepare');
    db = await openReplayDatabase(recording.filename);
    await db.destroy();
    expect(prepare).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should decode JSON, reject writes, and close after use without altering source bytes or schema', async () => {
    const close = vi.spyOn(Database.prototype, 'close');
    db = await openReplayDatabase(recording.filename);
    const row = await db.selectFrom('PlayerSummaries').selectAll().where('ID', '=', 3).executeTakeFirstOrThrow();
    expect(row.OutgoingTradeRoutes).toEqual({ 'Home => Port (Civ1)': { FromGold: 0, ToFood: -1 } });
    await expect(sql`CREATE TABLE unwanted (id INTEGER)`.execute(db)).rejects.toThrow();
    await expect(sql`UPDATE PlayerSummaries SET Gold = 7`.execute(db)).rejects.toThrow();
    expect((await sql`SELECT sql FROM sqlite_master ORDER BY name`.execute(db)).rows).toEqual(recording.schema);
    await db.destroy();
    expect(close).toHaveBeenCalledOnce();
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should fail opening a missing source without creating a database', async () => {
    const filename = path.join(path.dirname(recording.filename), 'missing.db');
    await expect(openReplayDatabase(filename)).rejects.toThrow();
    await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should recover recorded civilization identities and classify major players from IsMajor', async () => {
    const sqlite = new Database(recording.filename);
    sqlite.exec(`
      INSERT INTO PlayerInformations (Key, TeamID, IsMajor, Civilization, Leader, IsHuman)
        VALUES (2, 2, 0, 'Minor', 'City State', 0), (23, 23, 1, 'Major', 'Leader23', 0);
    `);
    sqlite.close();
    db = await openReplayDatabase(recording.filename);
    expect(await readReplayIdentities(db, 0)).toEqual({
      receiverTeamId: 0, receiverOwnerName: 'Civ0', civilization: 'Civ0',
      playerNames: { 0: 'Civ0', 1: 'Civ1', 2: 'Minor', 23: 'Major' },
      playerTeamIds: { 0: 0, 1: 1, 2: 2, 23: 23 },
      majorPlayerIds: [0, 1, 23],
    });
  });
});
